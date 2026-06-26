import type { PendingTask } from '../types/story-state.js'

const COMMON_TIME_WORDS = new Set([
  '明日', '后日', '今日', '昨日', '今晨', '今晚', '明早', '明晚',
  '卯时', '辰时', '巳时', '午时', '未时', '申时', '酉时', '戌时', '亥时',
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

function extractChineseKeywords(text: string): string[] {
  const sequences = text.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  const keywords = new Set<string>()
  for (const sequence of sequences) {
    const maxLen = Math.min(sequence.length, 4)
    for (let len = 2; len <= maxLen; len++) {
      for (let i = 0; i <= sequence.length - len; i++) {
        const word = sequence.slice(i, i + len)
        if (!COMMON_TIME_WORDS.has(word)) {
          keywords.add(word)
        }
      }
    }
  }
  return Array.from(keywords)
}

function hasKeywordOverlap(taskDescription: string, outlineDescription: string): boolean {
  const taskWords = new Set(extractChineseKeywords(taskDescription))
  if (taskWords.size === 0) return false
  const outlineWords = extractChineseKeywords(outlineDescription)
  let overlapCount = 0
  for (const word of outlineWords) {
    if (taskWords.has(word)) overlapCount++
  }
  return overlapCount >= 2
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

