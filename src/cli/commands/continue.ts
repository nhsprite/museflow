import { getStory, updateStoryStatus, initStoryDb } from '../../storage/database/dao/story.js'
import { continueStory, getState } from '../../core/runner.js'
import type { StoryStatus } from '../../types/story.js'
import { withSpinner } from '../utils/spinner.js'

interface ContinueOptions {
  storyId: string
  yes?: boolean
  no?: boolean
}

export async function cont(storyId: string, options: ContinueOptions): Promise<void> {
  const { yes, no } = options

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

  console.log(`[MuseFlow] 继续故事: ${story.title}`)
  console.log(`  当前章节: ${state.currentChapterIndex + 1}/${state.totalChapters}`)
  console.log(`  状态: ${state.rewriteRequested ? '等待重写确认' : '撰写中'}\n`)

  if (state.pendingIssues.length > 0) {
    console.log('[MuseFlow] 发现以下问题:')
    for (const issue of state.pendingIssues) {
      const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'
      console.log(`  ${icon} [${issue.type}] ${issue.description}`)
      if (issue.location) {
        console.log(`     位置: ${issue.location}`)
      }
    }
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
    updateStoryStatus(storyId, status)
  }

  try {
    const result = await withSpinner('正在处理章节...', () =>
      continueStory(storyId, userResponse)
    )

    const currentChapter = result.currentChapterIndex
    const totalChapters = result.totalChapters

    if (currentChapter < totalChapters) {
      console.log(`\n[MuseFlow] 第 ${currentChapter + 1}/${totalChapters} 章处理完成`)

      if (result.pendingIssues.length > 0) {
        const errors = result.pendingIssues.filter(i => i.severity === 'error')
        if (errors.length > 0) {
          console.log(`\n[MuseFlow] 发现 ${errors.length} 个严重问题`)
          console.log('[MuseFlow] 请使用 continue 命令继续处理')
        }
      }
    }

    if (currentChapter >= totalChapters) {
      updateStatus('done')
      console.log('\n[MuseFlow] 全部章节撰写完成！')
    } else if (!result.rewriteRequested) {
      updateStatus('writing')
    }

    console.log('\n[MuseFlow] 使用 "museflow status" 查看进度')

  } catch (err) {
    console.error('[MuseFlow] 错误:', err instanceof Error ? err.message : String(err))
    updateStatus('error')
    process.exit(1)
  }
}

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt)
    process.stdin.once('data', (data) => {
      resolve(data.toString().trim())
    })
  })
}