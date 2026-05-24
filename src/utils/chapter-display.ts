import type { ChapterOutline } from '../graph/state.js'

export function toDisplayChapterNumber(chapterIndex: number): number {
  return chapterIndex + 1
}

export function getCurrentChapterDisplayNumber(currentChapterIndex: number, totalChapters: number): number {
  if (totalChapters <= 0) return 0
  return Math.min(toDisplayChapterNumber(currentChapterIndex), totalChapters)
}

export function printChapterOutline(outlineItem: ChapterOutline | undefined, chapterIndex: number): boolean {
  if (!outlineItem) {
    console.error('[MuseFlow] 错误: 未找到章节大纲')
    return false
  }

  console.log('═'.repeat(60))
  console.log(`第 ${toDisplayChapterNumber(chapterIndex)} 章：${outlineItem.title}`)
  console.log('═'.repeat(60))
  console.log(`\n${outlineItem.description}\n`)
  return true
}
