import { getStory, updateStoryStatus, initStoryDb } from '../../storage/database/dao/story.js'
import { continueStory, getState } from '../../core/runner.js'
import type { StoryStatus } from '../../types/story.js'
import { withSpinner } from '../utils/spinner.js'
import { toDisplayChapterNumber } from '../../utils/chapter-display.js'

interface WriteOptions {
  storyId: string
}

export async function write(storyId: string, _options: WriteOptions): Promise<void> {
  await initStoryDb()
  const story = getStory(storyId)
  if (!story) {
    console.error(`[MuseFlow] 错误: 故事 "${storyId}" 不存在`)
    process.exit(1)
  }

  const state = await getState(storyId)
  if (!state) {
    console.error('[MuseFlow] 错误: 无法获取故事状态，请先运行 start')
    process.exit(1)
  }

  const isResume = state.currentChapterIndex > 0 || (state.chapters && state.chapters.some(c => c !== null))

  if (!isResume) {
    console.log(`[MuseFlow] 开始撰写: ${story.title}`)
    console.log(`  总章节: ${state.totalChapters}`)
    console.log(`  从第 1 章开始\n`)
  } else {
    console.log(`[MuseFlow] 继续撰写: ${story.title}`)
    console.log(`  总章节: ${state.totalChapters}`)
    console.log(`  当前章节: ${state.currentChapterIndex + 1}/${state.totalChapters}\n`)
  }

  await handleWrite(storyId, state)
}

async function handleWrite(storyId: string, state: Awaited<ReturnType<typeof getState>>): Promise<void> {
  if (!state) return

  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]

  if (!outlineItem) {
    console.error('[MuseFlow] 错误: 未找到章节大纲')
    return
  }

  console.log('═'.repeat(60))
  console.log(`第 ${toDisplayChapterNumber(chapterIndex)} 章：${outlineItem.title}`)
  console.log('═'.repeat(60))
  console.log(`\n${outlineItem.description}\n`)

  await executeWrite(storyId)
}

async function executeWrite(storyId: string): Promise<void> {
  const updateStatus = (status: StoryStatus) => {
    updateStoryStatus(storyId, status)
  }

  try {
    const result = await withSpinner('正在撰写章节...', () =>
      continueStory(storyId, undefined)
    )

    if (result.rewriteRequested) {
      console.log('[MuseFlow] 当前章节存在问题，请运行 "museflow rewrite" 重写')
      return
    }

    if (result.currentChapterIndex >= result.totalChapters) {
      updateStatus('done')
      return
    }

    updateStatus('writing')

    const writtenIndex = result.currentChapterIndex - 1
    const outlineItem = result.outline[writtenIndex]
    const errors = result.pendingIssues.filter(i => i.severity === 'error')

    if (errors.length > 0) {
      console.log(`\n[MuseFlow] 第 ${writtenIndex + 1}/${result.totalChapters} 章已完成`)
      if (outlineItem) {
        console.log(`  章节名: ${outlineItem.title}`)
      }
      console.log(`  状态: ${errors.length} 个严重问题需要处理`)
      console.log('  请运行 "museflow rewrite" 重写本章\n')
      return
    }

    console.log(`\n[MuseFlow] 第 ${writtenIndex + 1}/${result.totalChapters} 章已完成`)
    if (outlineItem) {
      console.log(`  章节名: ${outlineItem.title}`)
    }
    console.log('  状态: 正常')
    console.log('  输入 "museflow write" 继续下一章\n')

  } catch (err) {
    console.error('[MuseFlow] 错误:', err instanceof Error ? err.message : String(err))
    updateStatus('error')
    process.exit(1)
  }
}
