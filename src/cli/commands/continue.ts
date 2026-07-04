import { updateStoryStatus } from '../../storage/meta/stores/story.js'
import { runOneChapter } from '../../core/runner.js'
import type { StoryStatus } from '../../types/story.js'
import { withSpinner } from '../utils/spinner.js'
import { requireStoryState } from '../utils/story-loader.js'
import { resolveBlockingConflicts, isBlockingConflictError } from '../utils/conflict-resolver.js'
import type { ReducedGraphState } from '../../graph/state.js'
import { printActProgress } from '../utils/chapter-display.js'

interface ContinueOptions {
  storyId: string
  yes?: boolean
  no?: boolean
}

export async function cont(storyId: string, options: ContinueOptions): Promise<void> {
  const { yes, no } = options

  const { story, state } = await requireStoryState(storyId)

  if (state.currentChapterIndex >= state.totalChapters) {
    console.log(`[MuseFlow] 故事已完成: ${story.title}`)
    console.log(`  总章节: ${state.totalChapters}/${state.totalChapters} (100%)`)
    console.log('\n全部章节已撰写完成，无需继续。')
    console.log('使用以下命令查看或导出故事:')
    console.log(`   museflow status ${storyId}  # 查看进度`)
    console.log(`   museflow info ${storyId}     # 查看详情\n`)
    return
  }

  console.log(`[MuseFlow] 继续故事: ${story.title}`)
  console.log(`  当前章节: ${state.currentChapterIndex + 1}/${state.totalChapters}`)
  console.log(`  状态: ${state.rewriteRequested ? '等待重写确认' : '撰写中'}`)
  printActProgress(state, state.currentChapterIndex)
  console.log('')

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
    async function runWithConflictResolution(): Promise<ReducedGraphState> {
      try {
        return await withSpinner(
          '正在处理章节...',
          () => runOneChapter(storyId, { mode: 'continue', userResponse }),
          undefined,
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

    const currentChapter = result.currentChapterIndex
    const totalChapters = result.totalChapters
    const completedChapter = currentChapter
    const nextChapter = currentChapter + 1

    if (currentChapter < totalChapters) {
      console.log(`\n[MuseFlow] 第 ${completedChapter}/${totalChapters} 章已完成，待撰写: 第 ${nextChapter} 章`)

      if (result.pendingIssues.length > 0) {
        const errors = result.pendingIssues.filter(i => i.severity === 'error')
        if (errors.length > 0) {
          console.log(`\n[MuseFlow] 发现 ${errors.length} 个严重问题：`)
          for (const err of errors) {
            const icon = err.severity === 'error' ? '❌' : err.severity === 'warning' ? '⚠️' : 'ℹ️'
            console.log(`  ${icon} [${err.type}] ${err.description}`)
            if (err.location) {
              console.log(`     位置: ${err.location}`)
            }
          }
          console.log(`\n[MuseFlow] 请先重写本章后再继续：`)
          console.log(`   museflow rewrite ${storyId}  # 彻底重写\n`)
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
