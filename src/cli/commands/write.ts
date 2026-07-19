import { getState, updateStoryRuntimeStatus, type RunOneChapterOptions } from '../../core/runner.js'
import type { StoryStatus, Story } from '../../types/story.js'
import {
  printActProgress,
  printChapterOutline,
  printChapterReport,
  printIssues,
} from '../utils/chapter-display.js'
import { getChapterFilePath } from '../../utils/paths.js'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { requireStoryState } from '../utils/story-loader.js'
import { runOneChapterWithConflictResolution } from '../utils/chapter-runner.js'
import { handleCommandError } from '../utils/command-error.js'
import {
  writeBatchStopReasonLabel,
  type WriteBatchStopReason,
  type WriteIterationOutcome,
} from '../utils/write-batch.js'
import { evaluateStoryCompletion } from '../../core/story-completion.js'
import { getReachedStoryBoundary, printReachedStoryBoundary } from '../utils/story-boundary.js'

interface WriteOptions {
  storyId: string
  count?: number
}

export async function write(storyId: string, options: WriteOptions): Promise<void> {
  const requestedCount = options.count ?? 1
  const batchMode = requestedCount > 1
  let completedCount = 0
  let stopReason: WriteBatchStopReason = 'requested-count'

  try {
    for (let iteration = 0; iteration < requestedCount; iteration += 1) {
      const outcome = await writeOne(storyId, batchMode)
      if (outcome.completed) {
        completedCount += 1
      }
      if (outcome.stopReason) {
        stopReason = outcome.stopReason
        break
      }
    }
  } catch (err) {
    if (batchMode) {
      printWriteBatchSummary(requestedCount, completedCount, 'error')
    }
    await handleCommandError(storyId, err, {
      retryCommand: `museflow rewrite ${storyId}`,
    })
  }

  if (batchMode) {
    printWriteBatchSummary(requestedCount, completedCount, stopReason)
  }
}

async function writeOne(storyId: string, batchMode: boolean): Promise<WriteIterationOutcome> {
  const { story, state } = await requireStoryState(storyId)

  const hasChaptersOnDisk = checkExistingChapters(story.outputDir)

  let startChapterIndex = state.currentChapterIndex
  if (hasChaptersOnDisk) {
    const chaptersDir = join(story.outputDir, 'chapters')
    const files = readdirSync(chaptersDir).filter(
      (f) => f.startsWith('chapter_') && f.endsWith('.md')
    )
    const diskCount = files.length
    if (state.currentChapterIndex === 0) {
      startChapterIndex = diskCount
    } else if (diskCount < state.currentChapterIndex) {
      // checkpoint 领先于磁盘（commit 曾被中断）：从磁盘缺失处续写，避免跳过缺失章节
      startChapterIndex = diskCount
    }
  }

  const boundary = getReachedStoryBoundary(state)
  if (boundary) {
    printReachedStoryBoundary(boundary, storyId)
    return {
      completed: false,
      stopReason: boundary.status === 'complete' ? 'story-complete' : 'blocking-issues',
    }
  }

  const isResume = state.currentChapterIndex > 0 || hasChaptersOnDisk

  if (!isResume) {
    console.log(`[MuseFlow] 开始撰写: ${story.title}`)
    console.log(`  总章节: ${state.totalChapters}`)
    console.log('  从第 1 章开始')
    printActProgress(state, startChapterIndex)
    console.log('')
  } else {
    console.log(`[MuseFlow] 继续撰写: ${story.title}`)
    console.log(`  总章节: ${state.totalChapters}`)
    console.log(`  当前章节: ${startChapterIndex + 1}/${state.totalChapters}`)
    printActProgress(state, startChapterIndex)
    console.log('')
  }

  return handleWrite(story, state, startChapterIndex, batchMode)
}

async function handleWrite(
  story: Story,
  state: Awaited<ReturnType<typeof getState>>,
  startChapterIndex: number,
  batchMode: boolean
): Promise<WriteIterationOutcome> {
  if (!state) return { completed: false, stopReason: 'not-writable' }

  const unresolvedErrors = state.pendingIssues.filter((i) => i.severity === 'error')
  const nonDraftErrors = unresolvedErrors.filter((i) => i.type !== 'draft_failure')
  const hasOnlyDraftFailures =
    unresolvedErrors.length > 0 && unresolvedErrors.every((i) => i.type === 'draft_failure')

  // 仅当上一轮运行明确请求人工重写（rewriteRequested，干净的阻塞停止）时才拒绝续写。
  // 若上一轮在重写循环中途被中断（崩溃/Ctrl+C），遗留 error 不代表路由已放弃，
  // 应继续本章循环，由 runOneChapter 携带遗留问题反馈重跑。
  if (nonDraftErrors.length > 0 && !hasOnlyDraftFailures && state.rewriteRequested) {
    console.error('[MuseFlow] 当前章节存在问题，需要先修复')
    printIssues(state.pendingIssues, { log: console.error })
    console.error(`\n当前章节存在严重问题，需要重写：`)
    console.error(`   museflow rewrite ${story.id}  # 彻底重写\n`)
    if (batchMode) {
      return { completed: false, stopReason: 'blocking-issues' }
    }
    process.exit(1)
  }

  if (hasOnlyDraftFailures) {
    console.log('[MuseFlow] 检测到之前的生成失败，将重新尝试...')
    console.log('')
  }

  if (nonDraftErrors.length > 0 && !hasOnlyDraftFailures) {
    console.log('[MuseFlow] 检测到上次撰写在修复循环中被中断，将携带遗留问题继续本章...')
    printIssues(state.pendingIssues)
    console.log('')
  }

  const chapterIndex = startChapterIndex
  const outlineItem = state.outline[chapterIndex]

  if (!printChapterOutline(outlineItem, chapterIndex)) {
    return { completed: false, stopReason: 'no-progress' }
  }

  return executeWrite(story.id, state, chapterIndex, batchMode)
}

async function executeWrite(
  storyId: string,
  state: Awaited<ReturnType<typeof getState>>,
  startChapterIndex: number,
  batchMode: boolean
): Promise<WriteIterationOutcome> {
  if (!state) return { completed: false, stopReason: 'not-writable' }

  const updateStatus = (status: StoryStatus) => {
    return updateStoryRuntimeStatus(storyId, status)
  }

  const chapterIndex = startChapterIndex
  const chapterNum = chapterIndex + 1
  const totalChapters = state.totalChapters

  const runOptions: RunOneChapterOptions = {
    mode: 'draft',
    targetChapterIndex: chapterIndex,
  }

  const result = await runOneChapterWithConflictResolution(
    storyId,
    runOptions,
    `正在撰写第 ${chapterNum}/${totalChapters} 章...`,
    `✅ 第 ${chapterNum} 章撰写完成`
  )

  if (result.rewriteRequested) {
    const errors = result.pendingIssues.filter((i) => i.severity === 'error')
    console.log(`\n[MuseFlow] 检测到 ${errors.length} 个严重问题，撰写已中断：`)
    printIssues(errors)
    console.log(`\n请运行以下命令重写本章：`)
    console.log(`   museflow rewrite ${storyId}  # 彻底重写\n`)
    if (batchMode) {
      return { completed: false, stopReason: 'rewrite-requested' }
    }
    process.exit(1)
  }

  const madeProgress = result.currentChapterIndex > startChapterIndex
  if (!madeProgress) {
    return { completed: false, stopReason: 'no-progress' }
  }

  const writtenIndex = result.currentChapterIndex - 1
  const errors = result.pendingIssues.filter((i) => i.severity === 'error')

  printChapterReport(result.chapterReport, result)

  // Show file path
  const chapterPath = getChapterFilePath(state.story.outputDir, writtenIndex + 1)
  console.log(`\n📁 文件：${chapterPath}`)

  const completionAudit = evaluateStoryCompletion(result)
  await updateStatus('writing')

  if (completionAudit.status === 'complete') {
    if (errors.length === 0) {
      console.log('✨ 质量检查通过，故事已完成\n')
    }
    return { completed: true, stopReason: 'story-complete' }
  }

  if (completionAudit.chapterLimitReached) {
    console.log('\n[MuseFlow] 已到规划章节边界，但故事未通过完结门禁。')
    return { completed: true, stopReason: 'blocking-issues' }
  }

  if (errors.length > 0) {
    console.log(`\n请运行以下命令重写本章：`)
    console.log(`   museflow rewrite ${storyId}  # 彻底重写\n`)

    if (!batchMode) {
      console.log('下一步：')
      console.log(
        `   重写第 ${writtenIndex + 1} 章后，再运行 "museflow write" 继续撰写第 ${writtenIndex + 2} 章`
      )
      console.log(`   或运行 "museflow info" 查看故事进度\n`)
    }
    return { completed: true, stopReason: 'blocking-issues' }
  }

  console.log('✨ 质量检查通过\n')

  if (!batchMode) {
    console.log('下一步：')
    console.log(`   输入 "museflow write" 继续撰写第 ${writtenIndex + 2} 章`)
    console.log(`   或运行 "museflow info" 查看故事进度\n`)
  }

  return { completed: true }
}

function printWriteBatchSummary(
  requestedCount: number,
  completedCount: number,
  stopReason: WriteBatchStopReason
): void {
  console.log(`[MuseFlow] 连续写作结束：计划 ${requestedCount} 章 / 完成 ${completedCount} 章`)
  console.log(`  停止原因：${writeBatchStopReasonLabel(stopReason)}`)
  console.log('')
}

function checkExistingChapters(outputDir: string): boolean {
  const chaptersDir = join(outputDir, 'chapters')
  if (!existsSync(chaptersDir)) return false
  const files = readdirSync(chaptersDir).filter(
    (f) => f.startsWith('chapter_') && f.endsWith('.md')
  )
  return files.length > 0
}
