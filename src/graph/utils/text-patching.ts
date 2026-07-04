import { logger } from '../../utils/logger.js'
import type { IssueLocationRef } from '../../types/agent.js'

export interface LocationInfo {
  paragraphIndex?: number
  sentenceIndex?: number
}

export function splitIntoParagraphs(text: string): string[] {
  return text.split(/\n\n+/).filter((p) => p.trim().length > 0)
}

export function extractLocationInfo(issue: { locationRef?: IssueLocationRef }): LocationInfo[] {
  const ref = issue.locationRef
  if (!ref) return []

  const location: LocationInfo = {}
  if (isValidIndex(ref.paragraphIndex)) {
    location.paragraphIndex = ref.paragraphIndex
  }
  if (isValidIndex(ref.sentenceIndex)) {
    location.sentenceIndex = ref.sentenceIndex
  }

  return Object.keys(location).length > 0 ? [location] : []
}

function isValidIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function findAffectedParagraphs(
  paragraphs: string[],
  issues: Array<{ locationRef?: IssueLocationRef }>
): number[] {
  const affected = new Set<number>()

  for (const issue of issues) {
    const locations = extractLocationInfo(issue)
    const hasExplicitLocation = locations.some((l) => l.paragraphIndex !== undefined)

    if (hasExplicitLocation) {
      for (const loc of locations) {
        if (
          loc.paragraphIndex !== undefined &&
          loc.paragraphIndex >= 0 &&
          loc.paragraphIndex < paragraphs.length
        ) {
          affected.add(loc.paragraphIndex)
        }
      }
      continue
    }
  }

  return Array.from(affected).sort((a, b) => a - b)
}

export function splitParagraphIntoSentences(paragraph: string): string[] {
  const matches = [...paragraph.matchAll(/[^。！？\n]+[。！？\n]?/g)]
  if (matches.length === 0) return [paragraph]
  return matches.map((m) => m[0]).filter((s) => s.trim().length > 0)
}

export function findAffectedSentences(
  paragraph: string,
  issue: { locationRef?: IssueLocationRef }
): number[] {
  const sentences = splitParagraphIntoSentences(paragraph)
  const affected = new Set<number>()

  const locations = extractLocationInfo(issue)
  const hasSentenceLocation = locations.some((l) => l.sentenceIndex !== undefined)

  if (hasSentenceLocation) {
    for (const loc of locations) {
      if (
        loc.sentenceIndex !== undefined &&
        loc.sentenceIndex >= 0 &&
        loc.sentenceIndex < sentences.length
      ) {
        affected.add(loc.sentenceIndex)
      }
    }
    return Array.from(affected).sort((a, b) => a - b)
  }

  return Array.from(affected).sort((a, b) => a - b)
}

export function mergeSentenceFixes(
  originalParagraph: string,
  modifiedSentences: Array<{ index: number; content: string }>
): string {
  const sentences = splitParagraphIntoSentences(originalParagraph)
  const modifiedMap = new Map(modifiedSentences.map((s) => [s.index, s.content]))

  const result = sentences.map((s, i) => (modifiedMap.has(i) ? modifiedMap.get(i)! : s))
  return result.join('')
}

export function mergeParagraphFixes(
  originalParagraphs: string[],
  modifiedParagraphs: Array<{ index: number; content: string }>,
  affectedIndices: number[]
): string {
  const result = [...originalParagraphs]
  const modifiedMap = new Map(modifiedParagraphs.map((p) => [p.index, p.content]))

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
