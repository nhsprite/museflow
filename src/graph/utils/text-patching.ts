import { logger } from '../../utils/logger.js'
import { extractChineseKeywords } from '../../utils/text.js'
import { parseChineseNumber } from '../../utils/chapter-content-validation.js'

export interface LocationInfo {
  paragraphIndex?: number
  sentenceIndex?: number
}

export function splitIntoParagraphs(text: string): string[] {
  return text.split(/\n\n+/).filter(p => p.trim().length > 0)
}

export function extractLocationInfo(issue: { description: string; location?: string }): LocationInfo[] {
  const locations: LocationInfo[] = []
  const text = issue.description + ' ' + (issue.location || '')

  const CHINESE_NUMERAL_CLASS = '[一二三四五六七八九十百千万零]+'

  const paragraphPatterns = [
    /第\s*(\d+)\s*段/g,
    new RegExp(`第\\s*(${CHINESE_NUMERAL_CLASS})\\s*段`, 'g'),
    /段落?\s*(\d+)/g,
  ]

  for (const pattern of paragraphPatterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const group = match[1]
      if (!group) continue
      const num = parseLocationNumber(group)
      if (num !== null) {
        locations.push({ paragraphIndex: num - 1 })
      }
    }
  }

  const sentencePatterns = [
    /第\s*(\d+)\s*句/g,
    new RegExp(`第\\s*(${CHINESE_NUMERAL_CLASS})\\s*句`, 'g'),
  ]

  for (const pattern of sentencePatterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const group = match[1]
      if (!group) continue
      const num = parseLocationNumber(group)
      if (num !== null) {
        locations.push({ sentenceIndex: num - 1 })
      }
    }
  }

  return locations
}

function parseLocationNumber(str: string): number | null {
  const num = parseInt(str, 10)
  if (!isNaN(num)) return num

  const parsed = parseChineseNumber(str)
  return parsed !== null && parsed > 0 ? parsed : null
}

export function extractIssueKeywords(issue: { description: string; location?: string }): string[] {
  const text = issue.description + ' ' + (issue.location || '')
  const keywords: string[] = []

  // 优先保留引号内的明确表述。
  const quotes = text.match(/"([^"]+)"/g)
  if (quotes) {
    keywords.push(...quotes.map(q => q.slice(1, -1)))
  }

  // 使用通用 n-gram 提取，不再维护停用词列表。
  // 关键词长度限制在 2-6 字，避免过短噪音和过长片段。
  keywords.push(...extractChineseKeywords(text, { minLen: 2, maxLen: 6, ngrams: true }))

  const unique = [...new Set(keywords)]
  return unique.slice(0, 35)
}

export function findAffectedParagraphs(paragraphs: string[], issues: Array<{ description: string; location?: string }>): number[] {
  const affected = new Set<number>()

  for (const issue of issues) {
    const locations = extractLocationInfo(issue)
    const hasExplicitLocation = locations.some(l => l.paragraphIndex !== undefined)

    if (hasExplicitLocation) {
      for (const loc of locations) {
        if (loc.paragraphIndex !== undefined && loc.paragraphIndex >= 0 && loc.paragraphIndex < paragraphs.length) {
          affected.add(loc.paragraphIndex)
        }
      }
      continue
    }

    const keywords = extractIssueKeywords(issue)
    if (keywords.length === 0) continue

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i]
      if (paragraph && keywords.some(kw => paragraph.includes(kw))) {
        affected.add(i)
      }
    }
  }

  return Array.from(affected).sort((a, b) => a - b)
}

export function splitParagraphIntoSentences(paragraph: string): string[] {
  const matches = [...paragraph.matchAll(/[^。！？\n]+[。！？\n]?/g)]
  if (matches.length === 0) return [paragraph]
  return matches.map(m => m[0]).filter(s => s.trim().length > 0)
}

export function findAffectedSentences(paragraph: string, issue: { description: string; location?: string }): number[] {
  const sentences = splitParagraphIntoSentences(paragraph)
  const affected = new Set<number>()

  const locations = extractLocationInfo(issue)
  const hasSentenceLocation = locations.some(l => l.sentenceIndex !== undefined)

  if (hasSentenceLocation) {
    for (const loc of locations) {
      if (loc.sentenceIndex !== undefined && loc.sentenceIndex >= 0 && loc.sentenceIndex < sentences.length) {
        affected.add(loc.sentenceIndex)
      }
    }
    return Array.from(affected).sort((a, b) => a - b)
  }

  const keywords = extractIssueKeywords(issue)
  if (keywords.length === 0) return []

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]
    if (sentence && keywords.some(kw => sentence.includes(kw))) {
      affected.add(i)
    }
  }

  return Array.from(affected).sort((a, b) => a - b)
}

export function mergeSentenceFixes(
  originalParagraph: string,
  modifiedSentences: Array<{ index: number; content: string }>
): string {
  const sentences = splitParagraphIntoSentences(originalParagraph)
  const modifiedMap = new Map(modifiedSentences.map(s => [s.index, s.content]))

  const result = sentences.map((s, i) => modifiedMap.has(i) ? modifiedMap.get(i)! : s)
  return result.join('')
}

export function mergeParagraphFixes(
  originalParagraphs: string[],
  modifiedParagraphs: Array<{ index: number; content: string }>,
  affectedIndices: number[]
): string {
  const result = [...originalParagraphs]
  const modifiedMap = new Map(modifiedParagraphs.map(p => [p.index, p.content]))

  for (const idx of affectedIndices) {
    if (modifiedMap.has(idx)) {
      result[idx] = modifiedMap.get(idx)!
    }
  }

  return result.join('\n\n')
}

export function applyParagraphDiffProtection(
  original: string,
  fixed: string,
  allowedIndices: number[]
): string {
  const originalParagraphs = splitIntoParagraphs(original)
  const fixedParagraphs = splitIntoParagraphs(fixed)

  if (originalParagraphs.length !== fixedParagraphs.length) {
    logger.warn('[MuseFlow] 修复后段落数量变化，跳过段落保护')
    return fixed
  }

  const allowedSet = new Set(allowedIndices)
  let revertedCount = 0
  const result: string[] = []

  for (let i = 0; i < originalParagraphs.length; i++) {
    const originalParagraph = originalParagraphs[i]
    const fixedParagraph = fixedParagraphs[i]
    if (!originalParagraph || !fixedParagraph) {
      continue
    }
    if (!allowedSet.has(i) && originalParagraph !== fixedParagraph) {
      logger.info(`[MuseFlow] 检测到无关段落 ${i} 被修改，已自动回退`)
      result.push(originalParagraph)
      revertedCount++
    } else {
      result.push(fixedParagraph)
    }
  }

  if (revertedCount > 0) {
    logger.info(`[MuseFlow] 共回退 ${revertedCount} 个无关段落的修改`)
  }

  return result.join('\n\n')
}

export function deduplicateSentences(text: string): string {
  const MIN_SENTENCE_LENGTH = 10
  const SENTENCE_PATTERN = /[^。？！\n]+[。？！\n]/g

  const matches = [...text.matchAll(SENTENCE_PATTERN)]
  if (matches.length === 0) return text

  const seen = new Set<string>()
  let removedCount = 0
  const rebuilt: string[] = []
  let pos = 0

  for (const match of matches) {
    rebuilt.push(text.slice(pos, match.index))
    const sentence = match[0]
    const trimmed = sentence.trim()

    const isDuplicate = trimmed.length >= MIN_SENTENCE_LENGTH && seen.has(trimmed)
    if (isDuplicate) {
      removedCount++
    } else {
      seen.add(trimmed)
      rebuilt.push(sentence)
    }

    pos = (match.index ?? 0) + sentence.length
  }
  rebuilt.push(text.slice(pos))

  const finalText = rebuilt.join('')
  if (removedCount > 0) {
    logger.info(`[MuseFlow] 自动清理 ${removedCount} 个重复句子`)
  }
  return finalText
}

export function deduplicateParagraphBlocks(text: string): string {
  const paragraphs = splitIntoParagraphs(text)
  if (paragraphs.length < 2) return text

  const BLOCK_MIN_CHARS = 30
  const seenBlocks = new Set<string>()
  const result: string[] = []
  let removedCount = 0

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    if (trimmed.length < BLOCK_MIN_CHARS) {
      result.push(paragraph)
      continue
    }

    const normalized = trimmed.replace(/\s+/g, '')
    if (seenBlocks.has(normalized)) {
      removedCount++
      continue
    }
    seenBlocks.add(normalized)
    result.push(paragraph)
  }

  if (removedCount > 0) {
    logger.info(`[MuseFlow] 自动清理 ${removedCount} 个重复段落`)
  }
  return result.join('\n\n')
}
