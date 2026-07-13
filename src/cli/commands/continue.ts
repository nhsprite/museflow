import { updateStoryRuntimeStatus } from '../../core/runner.js'
import type { StoryStatus } from '../../types/story.js'
import { requireStoryState } from '../utils/story-loader.js'
import { printActProgress, printIssues } from '../utils/chapter-display.js'
import { guardStoryWritable } from '../utils/story-guard.js'
import { runOneChapterWithConflictResolution } from '../utils/chapter-runner.js'
import { handleCommandError } from '../utils/command-error.js'
import { question } from '../utils/prompt.js'

interface ContinueOptions {
  storyId: string
  yes?: boolean
  no?: boolean
}

export async function cont(storyId: string, options: ContinueOptions): Promise<void> {
  const { yes, no } = options

  const { story, state } = await requireStoryState(storyId)

  if (await guardStoryWritable(storyId, story, state)) {
    return
  }

  console.log(`[MuseFlow] 继续故事: ${story.title}`)
  console.log(`  当前章节: ${state.currentChapterIndex + 1}/${state.totalChapters}`)
  console.log(`  状态: ${state.rewriteRequested ? '等待重写确认' : '撰写中'}`)
  printActProgress(state, state.currentChapterIndex)
  console.log('')

  if (state.pendingIssues.length > 0) {
    printIssues(state.pendingIssues, { heading: '[MuseFlow] 发现以下问题:' })
    console.log()
  }

  if (state.rewriteRequested) {
    if (yes) {
      console.log('[MuseFlow] 自动确认重写请求')
      await handleContinue(storyId, true)
    } else if (no) {
      console.log('[MuseFlow] 自动拒绝重写请求')
      await handleContinue(storyId, false)
    } else {
      console.log('[MuseFlow] 是否确认重写当前章节?')
      console.log('  当前章节存在质量问题，建议重写')
      console.log('  输入 y 确认重写，输入 n 跳过重写继续下一章')
      const answer = await question('> ')
      const confirm = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
      await handleContinue(storyId, confirm)
    }
  } else {
    await handleContinue(storyId, undefined)
  }
}

async function handleContinue(storyId: string, userResponse?: boolean): Promise<void> {
  const updateStatus = (status: StoryStatus) => {
    return updateStoryRuntimeStatus(storyId, status)
  }

  try {
    const result = await runOneChapterWithConflictResolution(
      storyId,
      { mode: 'continue', userResponse },
      '正在处理章节...'
    )

    const currentChapter = result.currentChapterIndex
    const totalChapters = result.totalChapters
    const completedChapter = currentChapter
    const nextChapter = currentChapter + 1

    if (currentChapter < totalChapters) {
      console.log(
        `\n[MuseFlow] 第 ${completedChapter}/${totalChapters} 章已完成，待撰写: 第 ${nextChapter} 章`
      )

      if (result.pendingIssues.length > 0) {
        const errors = result.pendingIssues.filter((i) => i.severity === 'error')
        if (errors.length > 0) {
          console.log(`\n[MuseFlow] 发现 ${errors.length} 个严重问题：`)
          printIssues(errors)
          console.log(`\n[MuseFlow] 请先重写本章后再继续：`)
          console.log(`   museflow rewrite ${storyId}  # 彻底重写\n`)
        }
      }
    }

    if (currentChapter >= totalChapters) {
      await updateStatus('freeze')
      console.log('\n[MuseFlow] 全部章节撰写完成！')
    } else if (!result.rewriteRequested) {
      await updateStatus('writing')
    }

    console.log('\n[MuseFlow] 使用 "museflow status" 查看进度')
  } catch (err) {
    await handleCommandError(storyId, err, { updateStatus })
  }
}
