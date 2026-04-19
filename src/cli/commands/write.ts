import { getStory, updateStoryStatus, initStoryDb } from '../../storage/database/dao/story.js'
import { continueStory, getState } from '../../core/runner.js'
import type { StoryStatus } from '../../types/story.js'

interface WriteOptions {
  storyId: string
  yes?: boolean
  no?: boolean
}

export async function write(storyId: string, options: WriteOptions): Promise<void> {
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

  if (story.status === 'outlining') {
    console.log(`[MuseFlow] 开始撰写: ${story.idea}`)
    console.log(`  总章节: ${state.totalChapters}`)
    console.log(`  从第 1 章开始\n`)
  } else {
    console.log(`[MuseFlow] 继续撰写: ${story.idea}`)
    console.log(`  当前章节: ${state.currentChapterIndex + 1}/${state.totalChapters}`)
    console.log(`  状态: ${state.rewriteRequested ? '等待重写确认' : '撰写中'}\n`)
  }

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
      await handleWrite(storyId, true)
    } else if (no) {
      console.log('[MuseFlow] 自动拒绝重写请求')
      await handleWrite(storyId, false)
    } else {
      console.log('[MuseFlow] 是否确认重写当前章节?')
      console.log('  当前章节存在质量问题，建议重写')
      console.log('  输入 y 确认重写，输入 n 跳过重写继续下一章')
      const answer = await question('> ')
      const confirm = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
      await handleWrite(storyId, confirm)
    }
  } else {
    await handleWrite(storyId, undefined)
  }
}

async function handleWrite(storyId: string, userResponse?: boolean): Promise<void> {
  const updateStatus = (status: StoryStatus) => {
    updateStoryStatus(storyId, status)
  }

  try {
    const result = await continueStory(storyId, userResponse)

    const currentChapter = result.currentChapterIndex
    const totalChapters = result.totalChapters

    if (currentChapter >= totalChapters) {
      updateStatus('done')
    } else if (!result.rewriteRequested) {
      updateStatus('writing')
      await handleWrite(storyId, undefined)
    } else {
      console.log('\n[MuseFlow] 使用 "museflow write" 继续撰写')
    }

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
