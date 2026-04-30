import { getStory, initStoryDb } from '../../storage/database/dao/story.js'
import { getState } from '../../core/runner.js'
import { readChapterContent, listChapterFiles } from '../../storage/filesystem/writer.js'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

interface ExportOptions {
  storyId: string
  format?: string
}

export async function exportStory(storyId: string, options: ExportOptions): Promise<void> {
  await initStoryDb()
  const story = getStory(storyId)
  if (!story) {
    console.error(`[MuseFlow] 错误: 故事 "${storyId}" 不存在`)
    process.exit(1)
  }

  const state = await getState(storyId)
  if (!state) {
    console.error('[MuseFlow] 错误: 无法获取故事状态')
    process.exit(1)
  }

  const outputDir = story.outputDir
  const chapterNumbers = await listChapterFiles(outputDir)

  if (chapterNumbers.length === 0) {
    console.error('[MuseFlow] 错误: 未找到章节文件')
    process.exit(1)
  }

  console.log(`[MuseFlow] 导出故事: ${story.title}`)
  console.log(`  章节数: ${chapterNumbers.length}/${state.totalChapters}`)

  const lines: string[] = []

  lines.push(story.title)
  lines.push('')
  lines.push(`简介: ${story.idea}`)
  lines.push(`题材: ${story.genre}`)
  lines.push(`章节数: ${chapterNumbers.length}`)
  lines.push('')
  lines.push('='.repeat(60))
  lines.push('')

  for (const chapterNum of chapterNumbers) {
    const content = await readChapterContent(outputDir, chapterNum)
    if (!content) continue

    const outlineItem = state.outline[chapterNum - 1]
    const chapterTitle = outlineItem?.title || `第${chapterNum}章`

    lines.push(`第 ${chapterNum} 章: ${chapterTitle}`)
    lines.push('')
    lines.push(content.trim())
    lines.push('')
    lines.push('='.repeat(60))
    lines.push('')
  }

  const fileName = `${story.title || 'story'}_${storyId.slice(0, 8)}.txt`
  const filePath = join(outputDir, fileName)
  await writeFile(filePath, lines.join('\n'), 'utf-8')

  console.log(`\n[MuseFlow] 导出完成`)
  console.log(`  文件: ${filePath}`)
  console.log(`  章节: ${chapterNumbers.length} 章`)

  const totalChars = lines.join('').length
  console.log(`  字数: 约 ${totalChars} 字符`)
}
