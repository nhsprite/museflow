import { updateStoryStatus } from '../../storage/meta/stores/story.js'
import { runOneChapter, getState } from '../../core/runner.js'
import type { StoryStatus } from '../../types/story.js'
import { withSpinner } from '../utils/spinner.js'
import { printChapterOutline, printChapterReport } from '../utils/chapter-display.js'
import { createCheckpointService } from '../../storage/checkpoint-service.js'
import type { Issue } from '../../types/agent.js'
import { createInterface } from 'node:readline'
import { requireStoryState } from '../utils/story-loader.js'
import { resolveBlockingConflicts, isBlockingConflictError } from '../utils/conflict-resolver.js'

interface RewriteOptions {
  storyId: string
  chapter?: string
}

export async function rewrite(storyId: string, options: RewriteOptions): Promise<void> {
  const targetChapter = options.chapter ? parseInt(options.chapter, 10) : null

  const { story, state } = await requireStoryState(storyId)

  if (targetChapter !== null) {
    if (targetChapter < 1 || targetChapter > state.totalChapters) {
      console.error(`[MuseFlow] 错误: 章节编号必须在 1 到 ${state.totalChapters} 之间`)
      process.exit(1)
    }
    const targetIndex = targetChapter - 1
    console.log(`[MuseFlow] 重写章节: ${story.title}`)
    console.log(`  目标章节: ${targetChapter}/${state.totalChapters}`)
    console.log(`  原当前章节: ${state.currentChapterIndex + 1}`)
    const outlineItem = state.outline[targetIndex]
    printChapterOutline(outlineItem, targetIndex)
    await handleRewrite(storyId, true, targetIndex)
    return
  }

  const checkpointService = createCheckpointService(story.outputDir)
  await checkpointService.clearPendingWrites()

  let targetChapterIndex: number | undefined

  if (state.pendingIssues.length > 0) {
    const hasErrors = state.pendingIssues.some(i => i.severity === 'error')
    const currentChapterHasErrors = state.rewriteRequested || hasErrors
    targetChapterIndex = currentChapterHasErrors
      ? state.currentChapterIndex
      : Math.max(0, state.currentChapterIndex - 1)
    const chapterNum = targetChapterIndex + 1
    console.log('[MuseFlow] 重写章节: ', story.title)
    console.log(`  目标章节: ${chapterNum}/${state.totalChapters}`)
    const outlineItem = state.outline[targetChapterIndex]
    printChapterOutline(outlineItem, targetChapterIndex)
    console.log('[MuseFlow] 发现以下问题:')
    for (const issue of state.pendingIssues) {
      const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'
      console.log(`  ${icon} [${issue.type}] ${issue.description}`)
      if (issue.location) {
        console.log(`     位置: ${issue.location}`)
      }
    }
    console.log()
  } else {
    const chapterNum = state.currentChapterIndex + 1
    console.log(`[MuseFlow] 重写章节: ${story.title}`)
    console.log(`  目标章节: ${chapterNum}/${state.totalChapters}`)
    const outlineItem = state.outline[state.currentChapterIndex]
    printChapterOutline(outlineItem, state.currentChapterIndex)
    console.log('[MuseFlow] 当前章节没有已知问题，确认重写？')
    const answer = await question('  输入 y 确认重写，输入 n 取消 > ')
    const confirm = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
    if (!confirm) {
      console.log('[MuseFlow] 已取消')
      console.log('  输入 "museflow write" 查看故事状态或继续撰写\n')
      return
    }
  }

  await handleRewrite(storyId, true, targetChapterIndex, state.pendingIssues)
}

async function handleRewrite(
  storyId: string,
  userResponse: boolean,
  targetChapterIndex?: number,
  retryIssues: Issue[] = []
): Promise<void> {
  const updateStatus = (status: StoryStatus) => {
    updateStoryStatus(storyId, status)
  }

  const state = await getState(storyId)
  const chapterNum = targetChapterIndex !== undefined
    ? targetChapterIndex + 1
    : (state ? state.currentChapterIndex + 1 : 1)
  const totalChapters = state ? state.totalChapters : 0

  try {
    async function runWithConflictResolution(preserveTargetOutline = false) {
      try {
        return await withSpinner(
          `正在重写第 ${chapterNum}/${totalChapters} 章...`,
          () => runOneChapter(storyId, {
            mode: 'rewrite',
            targetChapterIndex,
            userResponse,
            retryIssues,
            ...(preserveTargetOutline ? { preserveTargetOutline: true } : {}),
          }),
          `✅ 第 ${chapterNum} 章重写完成`,
          (result) => !result.rewriteRequested
        )
      } catch (err) {
        if (isBlockingConflictError(err)) {
          const resolution = await resolveBlockingConflicts(storyId, err)
          return runWithConflictResolution(resolution.preserveTargetOutline)
        }
        throw err
      }
    }

    const result = await runWithConflictResolution()

    if (result.rewriteRequested) {
      const errors = result.pendingIssues.filter(i => i.severity === 'error')
      console.log(`\n[MuseFlow] 检测到 ${errors.length} 个严重问题，重写已中断：`)
      for (const err of errors) {
        const icon = err.severity === 'error' ? '❌' : err.severity === 'warning' ? '⚠️' : 'ℹ️'
        console.log(`  ${icon} [${err.type}] ${err.description}`)
        if (err.location) {
          console.log(`     位置: ${err.location}`)
        }
      }
      console.log(`\n请再次运行以下命令重写本章：`)
      console.log(`   museflow rewrite ${storyId}  # 彻底重写\n`)
      return
    }

    if (result.currentChapterIndex >= result.totalChapters) {
      updateStatus('done')
      return
    }

    updateStatus('writing')

    const errors = result.pendingIssues.filter(i => i.severity === 'error')

    printChapterReport(result.chapterReport)

    if (errors.length > 0) {
      console.log(`\n状态: 仍有 ${errors.length} 个严重问题`)
      console.log('请再次运行 "museflow rewrite" 重写本章\n')
      return
    }

    const fixedCount = state!.pendingIssues.filter(i => i.severity === 'error').length
    if (fixedCount > 0) {
      console.log(`\n已修复: ${fixedCount} 个严重问题`)
    }

    console.log('\n✨ 质量检查通过，运行 "museflow write" 继续下一章\n')

    const nextIndex = result.currentChapterIndex + 1
    if (nextIndex < result.totalChapters) {
      updateStatus('writing')
    } else {
      updateStatus('done')
    }

  } catch (err) {
    console.error('[MuseFlow] 错误:', err instanceof Error ? err.message : String(err))
    updateStatus('error')
    process.exit(1)
  }
}

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}
