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
import { guardStoryWritable } from '../utils/story-guard.js'
import { runOneChapterWithConflictResolution } from '../utils/chapter-runner.js'
import { handleCommandError } from '../utils/command-error.js'

interface WriteOptions {
  storyId: string
}

export async function write(storyId: string, _options: WriteOptions): Promise<void> {
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

  const isResume = state.currentChapterIndex > 0 || hasChaptersOnDisk

  if (await guardStoryWritable(storyId, story, state, startChapterIndex)) {
    return
  }

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

  await handleWrite(story, state, startChapterIndex)
}

async function handleWrite(
  story: Story,
  state: Awaited<ReturnType<typeof getState>>,
  startChapterIndex: number
): Promise<void> {
  if (!state) return

  const unresolvedErrors = state.pendingIssues.filter((i) => i.severity === 'error')
  const nonDraftErrors = unresolvedErrors.filter((i) => i.type !== 'draft_failure')
  const hasOnlyDraftFailures =
    unresolvedErrors.length > 0 && unresolvedErrors.every((i) => i.type === 'draft_failure')

  if (nonDraftErrors.length > 0 && !hasOnlyDraftFailures) {
    console.error('[MuseFlow] 当前章节存在问题，需要先修复')
    printIssues(state.pendingIssues, { log: console.error })
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

async function executeWrite(
  storyId: string,
  state: Awaited<ReturnType<typeof getState>>,
  startChapterIndex: number
): Promise<void> {
  if (!state) return

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

  try {
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
      process.exit(1)
    }

    if (result.currentChapterIndex >= result.totalChapters) {
      await updateStatus('freeze')
      return
    }

    await updateStatus('writing')

    const writtenIndex = result.currentChapterIndex - 1
    const errors = result.pendingIssues.filter((i) => i.severity === 'error')

    printChapterReport(result.chapterReport, result)

    // Show file path
    const chapterPath = getChapterFilePath(state.story.outputDir, writtenIndex + 1)
    console.log(`\n📁 文件：${chapterPath}`)

    if (errors.length > 0) {
      console.log(`\n请运行以下命令重写本章：`)
      console.log(`   museflow rewrite ${storyId}  # 彻底重写\n`)

      console.log('下一步：')
      console.log(
        `   重写第 ${writtenIndex + 1} 章后，再运行 "museflow write" 继续撰写第 ${writtenIndex + 2} 章`
      )
      console.log(`   或运行 "museflow info" 查看故事进度\n`)
    } else {
      console.log('✨ 质量检查通过\n')

      console.log('下一步：')
      console.log(`   输入 "museflow write" 继续撰写第 ${writtenIndex + 2} 章`)
      console.log(`   或运行 "museflow info" 查看故事进度\n`)
    }
  } catch (err) {
    await handleCommandError(storyId, err, {
      retryCommand: `museflow rewrite ${storyId}`,
      updateStatus,
    })
  }
}

function checkExistingChapters(outputDir: string): boolean {
  const chaptersDir = join(outputDir, 'chapters')
  if (!existsSync(chaptersDir)) return false
  const files = readdirSync(chaptersDir).filter(
    (f) => f.startsWith('chapter_') && f.endsWith('.md')
  )
  return files.length > 0
}
