import { getStory, updateStoryStatus, initStoryDb } from '../../storage/database/dao/story.js'
import { continueStory, getState } from '../../core/runner.js'
import type { StoryStatus } from '../../types/story.js'
import { withSpinner } from '../utils/spinner.js'
import { toDisplayChapterNumber } from '../../utils/chapter-display.js'
import { getChapterFilePath } from '../../utils/paths.js'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

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

  await executeWrite(storyId, state)
}

async function executeWrite(storyId: string, state: Awaited<ReturnType<typeof getState>>): Promise<void> {
  if (!state) return

  const updateStatus = (status: StoryStatus) => {
    updateStoryStatus(storyId, status)
  }

  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]

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
        const content = await readFile(chapterPath, 'utf-8')
        const wordCount = countChineseWords(content)
        console.log(`📝 字数：约 ${wordCount} 字`)
      }
    }

    if (errors.length > 0) {
      console.log(`\n⚠️  发现 ${errors.length} 个问题需要处理：`)
      for (const err of errors) {
        console.log(`   • ${err.description}`)
      }
      console.log('\n   运行 "museflow rewrite" 重写本章\n')
    } else {
      const warnings = result.pendingIssues.filter(i => i.severity === 'warning')
      if (warnings.length > 0) {
        console.log('\n💡 质量提示：')
        for (const warn of warnings) {
          console.log(`   • ${warn.description}`)
        }
        console.log('')
      }
      console.log('✨ 质量检查通过\n')
    }

    console.log('下一步：')
    console.log(`   输入 "museflow write" 继续撰写第 ${writtenIndex + 2} 章`)
    console.log(`   或运行 "museflow info" 查看故事进度\n`)

  } catch (err) {
    console.error('[MuseFlow] 错误:', err instanceof Error ? err.message : String(err))
    updateStatus('error')
    process.exit(1)
  }
}

function countChineseWords(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const englishWords = (text.match(/[a-zA-Z]+/g) ?? []).length
  return chineseChars + englishWords
}
