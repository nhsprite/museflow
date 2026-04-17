export function toDisplayChapterNumber(chapterIndex: number): number {
  return chapterIndex + 1
}

export function getCurrentChapterDisplayNumber(currentChapterIndex: number, totalChapters: number): number {
  if (totalChapters <= 0) return 0
  return Math.min(toDisplayChapterNumber(currentChapterIndex), totalChapters)
}
