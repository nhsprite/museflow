import type { ChapterOutline } from '../../graph/state.js'

function toDisplayChapterNumber(chapterIndex: number): number {
  return chapterIndex + 1
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
