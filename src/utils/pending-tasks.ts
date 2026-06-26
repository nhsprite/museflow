import type { PendingTask } from '../types/story-state.js'

export function agePendingTasks(
  tasks: PendingTask[],
  currentDisplayChapter: number
): PendingTask[] {
  return tasks.map(task => {
    if (task.status !== 'pending') return task
    if (task.dueChapter !== undefined && task.dueChapter <= currentDisplayChapter) {
      return { ...task, status: 'expired' as const }
    }
    return task
  })
}

function extractChineseKeywords(text: string): string[] {
  const sequences = text.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  const keywords = new Set<string>()
  for (const sequence of sequences) {
    const maxLen = Math.min(sequence.length, 4)
    for (let len = 2; len <= maxLen; len++) {
      for (let i = 0; i <= sequence.length - len; i++) {
        keywords.add(sequence.slice(i, i + len))
      }
    }
  }
  return Array.from(keywords)
}

function hasKeywordOverlap(taskDescription: string, outlineDescription: string): boolean {
  const taskWords = new Set(extractChineseKeywords(taskDescription))
  return extractChineseKeywords(outlineDescription).some(word => taskWords.has(word))
}

export function filterRelevantPendingTasks(
  tasks: PendingTask[],
  currentChapterIndex: number,
  outlineDescription: string
): PendingTask[] {
  const currentDisplayChapter = currentChapterIndex + 1
  return tasks.filter(task => {
    if (task.status !== 'pending') return false
    if (task.dueChapter === currentDisplayChapter) return true
    if (task.dueChapter === undefined && hasKeywordOverlap(task.description, outlineDescription)) {
      return true
    }
    return false
  })
}
