import { getStory, updateStoryStatus, initStoryDb } from '../../storage/database/dao/story.js'
import { continueStory, getState } from '../../core/runner.js'
import { getCheckpointer } from '../../graph/checkpointer.js'
import type { StoryStatus } from '../../types/story.js'
import { withSpinner } from '../utils/spinner.js'
import { toDisplayChapterNumber } from '../../utils/chapter-display.js'
import { getChapterFilePath, getOutputsDir } from '../../utils/paths.js'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readFile as readFileAsync } from 'node:fs/promises'

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

  await handleWrite(storyId, state, startChapterIndex)
}

async function handleWrite(storyId: string, state: Awaited<ReturnType<typeof getState>>, startChapterIndex: number): Promise<void> {
  if (!state) return

  const unresolvedErrors = state.pendingIssues.filter(i => i.severity === 'error')
  const nonDraftErrors = unresolvedErrors.filter(i => i.type !== 'draft_failure')
  const hasOnlyDraftFailures = unresolvedErrors.length > 0 && unresolvedErrors.every(i => i.type === 'draft_failure')

  if ((state.rewriteRequested || nonDraftErrors.length > 0) && !hasOnlyDraftFailures) {
    console.error('[MuseFlow] 当前章节存在问题，需要先修复')
    for (const issue of state.pendingIssues) {
      const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'
      console.error(`  ${icon} [${issue.type}] ${issue.description}`)
      if (issue.location) {
        console.error(`     位置: ${issue.location}`)
      }
    }
    console.error(`\n当前章节存在严重问题，需要重写：`)
    console.error(`   museflow rewrite ${storyId}  # 彻底重写\n`)
    process.exit(1)
  }

  if (hasOnlyDraftFailures) {
    console.log('[MuseFlow] 检测到之前的生成失败，将重新尝试...')
    console.log('')
  }

  const chapterIndex = startChapterIndex
  const outlineItem = state.outline[chapterIndex]

  if (!outlineItem) {
    console.error('[MuseFlow] 错误: 未找到章节大纲')
    return
  }

  console.log('═'.repeat(60))
  console.log(`第 ${toDisplayChapterNumber(chapterIndex)} 章：${outlineItem.title}`)
  console.log('═'.repeat(60))
  console.log(`\n${outlineItem.description}\n`)

  await executeWrite(storyId, state, chapterIndex)
}

async function executeWrite(storyId: string, state: Awaited<ReturnType<typeof getState>>, startChapterIndex: number): Promise<void> {
  if (!state) return

  const checkpointer = getCheckpointer()

  const pendingWrites = await checkpointer.loadPendingWritesForThread(state.story.outputDir)
  const activeChapterWrites = pendingWrites.filter(w => w.channel === 'chapters')
  if (activeChapterWrites.length > 0) {
    console.warn('[MuseFlow] 检测到残留的 pending writes，将清除后继续')
    console.warn('[MuseFlow] 这通常是由于上一次执行被中断导致的\n')
    await checkpointer.clearPendingWrites(state.story.outputDir)
  }

  const updateStatus = (status: StoryStatus) => {
    updateStoryStatus(storyId, status)
  }

  const chapterIndex = startChapterIndex
  const outlineItem = state.outline[chapterIndex]
  const chapterNum = chapterIndex + 1
  const totalChapters = state.totalChapters

  try {
    const result = await withSpinner(
      `正在撰写第 ${chapterNum}/${totalChapters} 章...`,
      () => continueStory(storyId, undefined, chapterIndex),
      `✅ 第 ${chapterNum} 章撰写完成`
    )

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
    const writtenOutlineItem = result.outline[writtenIndex]
    const errors = result.pendingIssues.filter(i => i.severity === 'error')

    // Show chapter completion info
    console.log('\n' + '═'.repeat(60))
    console.log(`✅ 第 ${writtenIndex + 1}/${result.totalChapters} 章撰写完成`)
    console.log('═'.repeat(60))

    if (writtenOutlineItem) {
      console.log(`\n📖 章节：${writtenOutlineItem.title}`)
    }

    // Show file path
    const story = getStory(storyId)
    if (story) {
      const chapterPath = getChapterFilePath(story.outputDir, writtenIndex + 1)
      console.log(`📁 文件：${chapterPath}`)

      // Show word count if file exists
      if (existsSync(chapterPath)) {
        const content = await readFileAsync(chapterPath, 'utf-8')
        const wordCount = countChineseWords(content)
        console.log(`📝 字数：约 ${wordCount} 字`)
      }
    }

    if (errors.length > 0) {
      const maxShow = 5
      const shown = errors.slice(0, maxShow)
      const remaining = errors.length - shown.length

      console.log(`\n⚠️  发现 ${errors.length} 个问题需要处理：`)
      for (const err of shown) {
        console.log(`   • ${err.description}`)
      }
      if (remaining > 0) {
        console.log(`   ... 还有 ${remaining} 个问题`)
      }
      console.log(`\n请运行以下命令重写本章：`)
      console.log(`   museflow rewrite ${storyId}  # 彻底重写\n`)

      console.log('下一步：')
      console.log(`   重写第 ${writtenIndex + 1} 章后，再运行 "museflow write" 继续撰写第 ${writtenIndex + 2} 章`)
      console.log(`   或运行 "museflow info" 查看故事进度\n`)
    } else {
      const warnings = result.pendingIssues.filter(i => i.severity === 'warning')
      if (warnings.length > 0) {
        const maxShow = 3
        const shown = warnings.slice(0, maxShow)
        const remaining = warnings.length - shown.length

        console.log('\n💡 质量提示：')
        for (const warn of shown) {
          console.log(`   • ${warn.description}`)
        }
        if (remaining > 0) {
          console.log(`   ... 还有 ${remaining} 条提示`)
        }
        console.log('')
      }
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

function countChineseWords(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const englishWords = (text.match(/[a-zA-Z]+/g) ?? []).length
  return chineseChars + englishWords
}

function checkExistingChapters(outputDir: string): boolean {
  const chaptersDir = join(outputDir, 'chapters')
  if (!existsSync(chaptersDir)) return false
  const files = readdirSync(chaptersDir).filter(f => f.startsWith('chapter_') && f.endsWith('.md'))
  return files.length > 0
}
