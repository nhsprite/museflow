import { updateStoryStatus } from '../../storage/meta/stores/story.js'
import { runOneChapter, getState, type RunOneChapterOptions } from '../../core/runner.js'
import type { StoryStatus, Story } from '../../types/story.js'
import type { ReducedGraphState } from '../../graph/state.js'
import { withSpinner } from '../utils/spinner.js'
import { printChapterOutline, printChapterReport } from '../utils/chapter-display.js'
import { getChapterFilePath } from '../../utils/paths.js'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { requireStoryState } from '../utils/story-loader.js'
import { resolveBlockingConflicts, isBlockingConflictError } from '../utils/conflict-resolver.js'

interface WriteOptions {
  storyId: string
}

export async function write(storyId: string, _options: WriteOptions): Promise<void> {
  const { story, state } = await requireStoryState(storyId)

  const hasChaptersOnDisk = checkExistingChapters(story.outputDir)

  let startChapterIndex = state.currentChapterIndex
  if (hasChaptersOnDisk && state.currentChapterIndex === 0) {
    const chaptersDir = join(story.outputDir, 'chapters')
    const files = readdirSync(chaptersDir).filter(f => f.startsWith('chapter_') && f.endsWith('.md'))
    startChapterIndex = files.length
  }

  const isResume = state.currentChapterIndex > 0 || hasChaptersOnDisk

  // If disk has more chapters than state.currentChapterIndex, use disk count
  if (hasChaptersOnDisk && startChapterIndex < state.currentChapterIndex) {
    startChapterIndex = state.currentChapterIndex
  }

  if (startChapterIndex >= state.totalChapters) {
    console.log(`[MuseFlow] 故事已完成: ${story.title}`)
    console.log(`  总章节: ${state.totalChapters}/${state.totalChapters} (100%)`)
    console.log('\n全部章节已撰写完成，无需继续。')
    console.log('使用以下命令查看或导出故事:')
    console.log(`   museflow status ${storyId}  # 查看进度`)
    console.log(`   museflow info ${storyId}     # 查看详情`)
    console.log(`   museflow export ${storyId}   # 导出为 txt 文件\n`)
    return
  }

  if (!isResume) {
    console.log(`[MuseFlow] 开始撰写: ${story.title}`)
    console.log(`  总章节: ${state.totalChapters}`)
    console.log(`  从第 1 章开始\n`)
  } else {
    console.log(`[MuseFlow] 继续撰写: ${story.title}`)
    console.log(`  总章节: ${state.totalChapters}`)
    console.log(`  当前章节: ${startChapterIndex + 1}/${state.totalChapters}\n`)
  }

  await handleWrite(story, state, startChapterIndex)
}

async function handleWrite(story: Story, state: Awaited<ReturnType<typeof getState>>, startChapterIndex: number): Promise<void> {
  if (!state) return

  const unresolvedErrors = state.pendingIssues.filter(i => i.severity === 'error')
  const nonDraftErrors = unresolvedErrors.filter(i => i.type !== 'draft_failure')
  const hasOnlyDraftFailures = unresolvedErrors.length > 0 && unresolvedErrors.every(i => i.type === 'draft_failure')

  // 当用户主动运行 write 时，清除 rewriteRequested 状态，让 agents 重新评估
  const effectiveRewriteRequested = false

  if ((effectiveRewriteRequested || nonDraftErrors.length > 0) && !hasOnlyDraftFailures) {
    console.error('[MuseFlow] 当前章节存在问题，需要先修复')
    for (const issue of state.pendingIssues) {
      const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'
      console.error(`  ${icon} [${issue.type}] ${issue.description}`)
      if (issue.location) {
        console.error(`     位置: ${issue.location}`)
      }
    }
    console.error(`\n当前章节存在严重问题，需要重写：`)
    console.error(`   museflow rewrite ${story.id}  # 彻底重写\n`)
    process.exit(1)
  }

  if (hasOnlyDraftFailures) {
    console.log('[MuseFlow] 检测到之前的生成失败，将重新尝试...')
    console.log('')
  }

  const chapterIndex = startChapterIndex
  const outlineItem = state.outline[chapterIndex]

  if (!printChapterOutline(outlineItem, chapterIndex)) {
    return
  }

  await executeWrite(story.id, state, chapterIndex)
}

async function executeWrite(storyId: string, state: Awaited<ReturnType<typeof getState>>, startChapterIndex: number): Promise<void> {
  if (!state) return

  const updateStatus = (status: StoryStatus) => {
    updateStoryStatus(storyId, status)
  }

  const chapterIndex = startChapterIndex
  const chapterNum = chapterIndex + 1
  const totalChapters = state.totalChapters

  const runOptions: RunOneChapterOptions = {
    mode: 'draft',
    targetChapterIndex: chapterIndex,
  }

  try {
    async function runWithConflictResolution(): Promise<ReducedGraphState> {
      try {
        return await withSpinner(
          `正在撰写第 ${chapterNum}/${totalChapters} 章...`,
          () => runOneChapter(storyId, runOptions),
          `✅ 第 ${chapterNum} 章撰写完成`,
          (result) => !result.rewriteRequested
        )
      } catch (err) {
        if (isBlockingConflictError(err)) {
          await resolveBlockingConflicts(storyId, err)
          return runWithConflictResolution()
        }
        throw err
      }
    }

    const result = await runWithConflictResolution()

    if (result.rewriteRequested) {
      const errors = result.pendingIssues.filter(i => i.severity === 'error')
      console.log(`\n[MuseFlow] 检测到 ${errors.length} 个严重问题，撰写已中断：`)
      for (const err of errors) {
        const icon = err.severity === 'error' ? '❌' : err.severity === 'warning' ? '⚠️' : 'ℹ️'
        console.log(`  ${icon} [${err.type}] ${err.description}`)
        if (err.location) {
          console.log(`     位置: ${err.location}`)
        }
      }
      console.log(`\n请运行以下命令重写本章：`)
      console.log(`   museflow rewrite ${storyId}  # 彻底重写\n`)
      return
    }

    if (result.currentChapterIndex >= result.totalChapters) {
      updateStatus('done')
      return
    }

    updateStatus('writing')

    const writtenIndex = result.currentChapterIndex - 1
    const errors = result.pendingIssues.filter(i => i.severity === 'error')

    printChapterReport(result.chapterReport)

    // Show file path
    const chapterPath = getChapterFilePath(state.story.outputDir, writtenIndex + 1)
    console.log(`\n📁 文件：${chapterPath}`)

    if (errors.length > 0) {
      console.log(`\n请运行以下命令重写本章：`)
      console.log(`   museflow rewrite ${storyId}  # 彻底重写\n`)

      console.log('下一步：')
      console.log(`   重写第 ${writtenIndex + 1} 章后，再运行 "museflow write" 继续撰写第 ${writtenIndex + 2} 章`)
      console.log(`   或运行 "museflow info" 查看故事进度\n`)
    } else {
      console.log('✨ 质量检查通过\n')

      console.log('下一步：')
      console.log(`   输入 "museflow write" 继续撰写第 ${writtenIndex + 2} 章`)
      console.log(`   或运行 "museflow info" 查看故事进度\n`)
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('Branch condition returned unknown or null destination')) {
      console.error('[MuseFlow] 错误: 章节处理流程异常')
    } else {
      console.error('[MuseFlow] 错误:', message)
    }
    console.error('')
    console.error('可以运行以下命令重试：')
    console.error(`   museflow rewrite ${storyId}`)
    console.error('')
    updateStatus('error')
    process.exit(1)
  }
}

function checkExistingChapters(outputDir: string): boolean {
  const chaptersDir = join(outputDir, 'chapters')
  if (!existsSync(chaptersDir)) return false
  const files = readdirSync(chaptersDir).filter(f => f.startsWith('chapter_') && f.endsWith('.md'))
  return files.length > 0
}
