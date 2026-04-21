import { getStory, updateStoryStatus, initStoryDb } from '../../storage/database/dao/story.js'
import { continueStory, getState } from '../../core/runner.js'
import type { StoryStatus } from '../../types/story.js'
import { withSpinner } from '../utils/spinner.js'

interface RewriteOptions {
  storyId: string
}

export async function rewrite(storyId: string, _options: RewriteOptions): Promise<void> {
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

  if (state.pendingIssues.length > 0) {
    console.log('[MuseFlow] 重写章节: ', story.title)
    console.log(`  当前章节: ${state.currentChapterIndex + 1}/${state.totalChapters}`)
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
    console.log(`[MuseFlow] 重写章节: ${story.title}`)
    console.log(`  当前章节: ${state.currentChapterIndex + 1}/${state.totalChapters}`)
    console.log('[MuseFlow] 当前章节没有已知问题，确认重写？')
    const answer = await question('  输入 y 确认重写，输入 n 取消 > ')
    const confirm = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
    if (!confirm) {
      console.log('[MuseFlow] 已取消')
      return
    }
  }

  await handleRewrite(storyId, true)
}

async function handleRewrite(storyId: string, userResponse: boolean): Promise<void> {
  const updateStatus = (status: StoryStatus) => {
    updateStoryStatus(storyId, status)
  }

  try {
    const result = await withSpinner('正在重写章节...', () =>
      continueStory(storyId, userResponse)
    )

    if (result.rewriteRequested) {
      console.log('\n[MuseFlow] 重写完成，使用 "museflow write" 继续')
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
      console.log(`\n[MuseFlow] 第 ${writtenIndex + 1}/${result.totalChapters} 章重写完成`)
      if (outlineItem) {
        console.log(`  章节名: ${outlineItem.title}`)
      }
      console.log(`  状态: 仍有 ${errors.length} 个严重问题`)
      console.log('  请再次运行 "museflow rewrite" 重写本章\n')
      return
    }

    console.log(`\n[MuseFlow] 第 ${writtenIndex + 1}/${result.totalChapters} 章重写完成`)
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

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt)
    process.stdin.once('data', (data) => {
      resolve(data.toString().trim())
    })
  })
}
