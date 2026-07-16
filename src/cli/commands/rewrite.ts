import { getState, updateStoryRuntimeStatus } from '../../core/runner.js'
import { prepareRewritePreviewState } from '../../core/rewrite-state.js'
import type { StoryStatus } from '../../types/story.js'
import {
  printActProgress,
  printChapterOutline,
  printChapterReport,
  printIssues,
} from '../utils/chapter-display.js'
import { createCheckpointService } from '../../storage/checkpoint-service.js'
import type { Issue } from '../../types/agent.js'
import { requireStoryState } from '../utils/story-loader.js'
import { guardStoryWritable } from '../utils/story-guard.js'
import { runOneChapterWithConflictResolution } from '../utils/chapter-runner.js'
import { handleCommandError } from '../utils/command-error.js'
import { question } from '../utils/prompt.js'

interface RewriteOptions {
  storyId: string
  chapter?: string
}

export async function rewrite(storyId: string, options: RewriteOptions): Promise<void> {
  const targetChapter = options.chapter ? parseInt(options.chapter, 10) : null

  const { story, state } = await requireStoryState(storyId)

  if (await guardStoryWritable(storyId, story, state)) {
    return
  }

  if (targetChapter !== null) {
    if (targetChapter < 1 || targetChapter > state.totalChapters) {
      console.error(`[MuseFlow] 错误: 章节编号必须在 1 到 ${state.totalChapters} 之间`)
      process.exit(1)
    }
    const targetIndex = targetChapter - 1
    const previewState = prepareRewritePreviewState(state, targetIndex)
    console.log(`[MuseFlow] 重写章节: ${story.title}`)
    console.log(`  目标章节: ${targetChapter}/${state.totalChapters}`)
    console.log(`  原当前章节: ${state.currentChapterIndex + 1}`)
    printActProgress(previewState, targetIndex)
    const outlineItem = previewState.outline[targetIndex]
    printChapterOutline(outlineItem, targetIndex)
    const retryIssues = targetIndex === state.currentChapterIndex ? state.pendingIssues : []
    await handleRewrite(storyId, true, targetIndex, retryIssues)
    return
  }

  const checkpointService = createCheckpointService(story.outputDir)
  await checkpointService.clearPendingWrites()

  let targetChapterIndex: number | undefined

  if (state.pendingIssues.length > 0) {
    const hasErrors = state.pendingIssues.some((i) => i.severity === 'error')
    const currentChapterHasErrors = state.rewriteRequested || hasErrors
    targetChapterIndex = currentChapterHasErrors
      ? state.currentChapterIndex
      : Math.max(0, state.currentChapterIndex - 1)
    const chapterNum = targetChapterIndex + 1
    const previewState = prepareRewritePreviewState(state, targetChapterIndex)
    console.log('[MuseFlow] 重写章节: ', story.title)
    console.log(`  目标章节: ${chapterNum}/${state.totalChapters}`)
    printActProgress(previewState, targetChapterIndex)
    const outlineItem = previewState.outline[targetChapterIndex]
    printChapterOutline(outlineItem, targetChapterIndex)
    console.log('[MuseFlow] 发现以下问题:')
    printIssues(state.pendingIssues)
    console.log()
  } else {
    targetChapterIndex = state.currentChapterIndex
    const chapterNum = targetChapterIndex + 1
    const previewState = prepareRewritePreviewState(state, targetChapterIndex)
    console.log(`[MuseFlow] 重写章节: ${story.title}`)
    console.log(`  目标章节: ${chapterNum}/${state.totalChapters}`)
    printActProgress(previewState, targetChapterIndex)
    const outlineItem = previewState.outline[targetChapterIndex]
    printChapterOutline(outlineItem, targetChapterIndex)
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
    return updateStoryRuntimeStatus(storyId, status)
  }

  const state = await getState(storyId)
  const chapterNum =
    targetChapterIndex !== undefined
      ? targetChapterIndex + 1
      : state
        ? state.currentChapterIndex + 1
        : 1
  const totalChapters = state ? state.totalChapters : 0

  try {
    const result = await runOneChapterWithConflictResolution(
      storyId,
      {
        mode: 'rewrite',
        targetChapterIndex,
        userResponse,
        retryIssues,
      },
      `正在重写第 ${chapterNum}/${totalChapters} 章...`,
      `✅ 第 ${chapterNum} 章重写完成`
    )

    if (result.rewriteRequested) {
      const errors = result.pendingIssues.filter((i) => i.severity === 'error')
      console.log(`\n[MuseFlow] 检测到 ${errors.length} 个严重问题，重写已中断：`)
      printIssues(errors)
      console.log(`\n请再次运行以下命令重写本章：`)
      console.log(`   museflow rewrite ${storyId}  # 彻底重写\n`)
      return
    }

    const errors = result.pendingIssues.filter((i) => i.severity === 'error')

    printChapterReport(result.chapterReport, result)

    if (result.currentChapterIndex >= result.totalChapters) {
      await updateStatus('freeze')
      if (errors.length === 0) {
        console.log('\n✨ 质量检查通过，故事已完成并冻结\n')
      }
      return
    }

    await updateStatus('writing')

    if (errors.length > 0) {
      console.log(`\n状态: 仍有 ${errors.length} 个严重问题`)
      console.log('请再次运行 "museflow rewrite" 重写本章\n')
      return
    }

    const fixedCount = state!.pendingIssues.filter((i) => i.severity === 'error').length
    if (fixedCount > 0) {
      console.log(`\n已修复: ${fixedCount} 个严重问题`)
    }

    console.log('\n✨ 质量检查通过，运行 "museflow write" 继续下一章\n')
  } catch (err) {
    await handleCommandError(storyId, err, {
      retryCommand: `museflow rewrite ${storyId}`,
      updateStatus,
    })
  }
}
