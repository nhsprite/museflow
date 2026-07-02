import type { CanonicalFact } from '../types/story-state.js'
import { logger } from './logger.js'

function normalizeForMatch(text: string): string {
  return text.replace(/[\s\n\p{P}]/gu, '')
}

function findSentenceContaining(summary: string, keyword: string): string | null {
  if (keyword.length === 0) return null
  const sentences = summary.split(/(?<=[。！？；])/u)
  const normalizedKeyword = normalizeForMatch(keyword)
  if (normalizedKeyword.length === 0) return null

  for (const sentence of sentences) {
    if (normalizeForMatch(sentence).includes(normalizedKeyword)) {
      return sentence.trim()
    }
  }
  return null
}

/**
 * 在旧章节摘要中追加权威事实覆盖注释。
 *
 * 只修改摘要文本，不修改原始章节文件。
 * 如果找不到包含旧事实的句子，则跳过该条事实，避免硬改摘要。
 */
export function patchChapterSummaryWithFacts(
  summary: string,
  facts: CanonicalFact[],
  chapterIndex: number
): string {
  if (!summary || facts.length === 0) return summary

  const displayChapter = chapterIndex + 1
  let patched = summary
  const applied: string[] = []

  for (const fact of facts) {
    if (!fact.supersedes || fact.supersedes.length === 0) continue

    for (const old of fact.supersedes) {
      if (old.oldValue.length === 0) continue
      const sentence = findSentenceContaining(patched, old.oldValue)
      if (!sentence) continue

      const note = `（注：该事实已于第${fact.establishedIn + 1}章更新为「${fact.value}」）`
      if (patched.includes(note)) continue

      const patchedSentence = `${sentence}${note}`
      patched = patched.replace(sentence, patchedSentence)
      applied.push(`[${fact.subject}] ${old.oldValue} → ${fact.value}`)
    }
  }

  if (applied.length > 0) {
    logger.info(`[MuseFlow] 已为第 ${displayChapter} 章摘要追加 ${applied.length} 条权威事实覆盖注释`)
  }

  return patched
}
