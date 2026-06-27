import type { PendingTask } from '../types/story-state.js'
import { extractChineseKeywords } from './text.js'

export const DEFAULT_TIME_WORDS = new Set([
  '明日', '后日', '今日', '昨日', '今晨', '今晚', '明早', '明晚',
  '期限', '截止', '到期', '之前', '之后', '限期',
])

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

function hasKeywordOverlap(
  taskDescription: string,
  outlineDescription: string,
  timeWords: Set<string>,
): boolean {
  const taskWords = new Set(extractChineseKeywords(taskDescription, { stopWords: timeWords }))
  if (taskWords.size === 0) return false
  const outlineWords = extractChineseKeywords(outlineDescription, { stopWords: timeWords })
  let overlapCount = 0
  for (const word of outlineWords) {
    if (taskWords.has(word)) overlapCount++
  }
  return overlapCount >= 2
}

export function filterRelevantPendingTasks(
  tasks: PendingTask[],
  currentChapterIndex: number,
  outlineDescription: string,
  customTimeWords?: Set<string>,
): PendingTask[] {
  const timeWords = customTimeWords ?? DEFAULT_TIME_WORDS
  const currentDisplayChapter = currentChapterIndex + 1
  return tasks.filter(task => {
    if (task.status !== 'pending') return false
    if (task.dueChapter === currentDisplayChapter) return true
    if (task.dueChapter === undefined && hasKeywordOverlap(task.description, outlineDescription, timeWords)) {
      return true
    }
    return false
  })
}
