import { countChineseWords, extractChineseKeywords } from './text.js'
import type { ModelProvider } from '../model/provider.js'
import { batchValidateFixedContent } from './context-judge.js'
import { DEFAULT_CHAPTER_WORD_COUNT_MIN, DEFAULT_CHAPTER_WORD_COUNT_MAX } from '../types/genre.js'

interface ValidationOptions {
  chapterIndex: number
  minWordCount?: number
  maxWordCount?: number
}

interface ValidationResult {
  valid: boolean
  content?: string
  error?: string
}

const CHINESE_NUMERALS: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '百': 100, '千': 1000, '万': 10000,
}

const REVISION_PLAN_KEYWORDS = [
  '问题分析',
  '修复建议',
  '修改建议',
  '改进建议',
  '修改计划',
  '修订计划',
  '问题清单',
  '修复清单',
  '修改点',
  '需修改',
  '待修复',
]

function detectRevisionPlanShape(text: string): boolean {
  let hitCount = 0
  for (const keyword of REVISION_PLAN_KEYWORDS) {
    if (text.includes(keyword)) hitCount++
  }
  return hitCount >= 2
}

function parseChineseNumber(str: string): number | null {
  let result = 0
  let currentUnit = 0
  let hasDigit = false

  for (const char of str) {
    const value = CHINESE_NUMERALS[char]
    if (value === undefined) return null
    hasDigit = true

    if (value >= 10) {
      if (currentUnit === 0) {
        currentUnit = 1
      }
      result += currentUnit * value
      currentUnit = 0
    } else {
      currentUnit = currentUnit * 10 + value
    }
  }

  if (!hasDigit) return null
  return result + currentUnit
}

export function findChapterHeading(text: string): string | null {
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^#{1,2}\s+第\s*[一二三四五六七八九十百千万\d]+\s*章/.test(trimmed)) {
      return trimmed
    }
  }
  return null
}

export function extractChapterNumber(heading: string): number | null {
  const match = heading.match(/第\s*([一二三四五六七八九十百千万\d]+)\s*章/)
  if (match && match[1]) {
    const arabic = parseInt(match[1], 10)
    if (!isNaN(arabic)) return arabic
    return parseChineseNumber(match[1])
  }
  return null
}

function countIntersection(a: Set<string>, b: Set<string>): number {
  let count = 0
  for (const value of a) {
    if (b.has(value)) count++
  }
  return count
}

export interface ChapterHeadingCorrection {
  corrected: string
  originalFoundNumber: number
  reason: string
}

/**
 * 当模型把本章内容误标为下一章时，尝试修正章节标题。
 *
 * 仅当满足以下条件时才修正：
 * 1. 检测到的章节号正好是期望章节号 + 1（模型被后续章节边界提示干扰）；
 * 2. 正文与当前章大纲的关键词重叠度明显高于与下一章大纲的重叠度，
 *    说明正文确实属于当前章，只是标题编号写错。
 */
export function tryCorrectOffByOneChapterHeading(
  rawContent: string,
  chapterIndex: number,
  currentOutlineDescription: string,
  nextOutlineDescription: string | undefined,
  minOverlapRatio = 1.5
): ChapterHeadingCorrection | null {
  const expectedDisplayNumber = chapterIndex + 1
  const heading = findChapterHeading(rawContent)
  if (!heading) return null

  const foundChapterNumber = extractChapterNumber(heading)
  if (foundChapterNumber !== expectedDisplayNumber + 1) return null

  if (!nextOutlineDescription || nextOutlineDescription.trim().length === 0) return null

  const currentKeywords = new Set(extractChineseKeywords(rawContent))
  const currentOutlineKeywords = new Set(extractChineseKeywords(currentOutlineDescription))
  const nextOutlineKeywords = new Set(extractChineseKeywords(nextOutlineDescription))

  const currentOverlap = countIntersection(currentKeywords, currentOutlineKeywords)
  const nextOverlap = countIntersection(currentKeywords, nextOutlineKeywords)

  if (currentOverlap === 0 || nextOverlap === 0) return null
  if (currentOverlap / nextOverlap < minOverlapRatio) return null

  const correctedHeading = heading.replace(
    /第\s*([一二三四五六七八九十百千万\d]+)\s*章/,
    `第${expectedDisplayNumber}章`
  )
  const correctedContent = rawContent.replace(heading, correctedHeading)

  return {
    corrected: correctedContent,
    originalFoundNumber: foundChapterNumber,
    reason: `正文与当前章大纲共有 ${currentOverlap} 个关键词，与下一章仅有 ${nextOverlap} 个，判定为章节号笔误`,
  }
}

export async function validateFixedChapterContent(
  rawContent: string,
  options: ValidationOptions,
  provider?: ModelProvider
): Promise<ValidationResult> {
  const { chapterIndex, minWordCount = DEFAULT_CHAPTER_WORD_COUNT_MIN, maxWordCount = DEFAULT_CHAPTER_WORD_COUNT_MAX } = options

  if (!rawContent || rawContent.trim().length === 0) {
    return { valid: false, error: '修复后的内容为空' }
  }

  const heading = findChapterHeading(rawContent)
  if (!heading) {
    return { valid: false, error: '修复后的内容缺少章节标题（# 第X章 ...）' }
  }

  const foundChapterNumber = extractChapterNumber(heading)
  const expectedDisplayNumber = chapterIndex + 1
  if (foundChapterNumber !== null && foundChapterNumber !== expectedDisplayNumber) {
    return {
      valid: false,
      error: `修复后的内容章节号不匹配：期望第${expectedDisplayNumber}章，实际第${foundChapterNumber}章`,
    }
  }

  if (detectRevisionPlanShape(rawContent)) {
    return { valid: false, error: '修复后的内容疑似修改计划或问题分析，不是正文' }
  }

  const wordCount = countChineseWords(rawContent)
  if (wordCount < minWordCount) {
    return {
      valid: false,
      error: `修复后的内容字数 ${wordCount} 低于最低要求 ${minWordCount}`,
    }
  }

  if (maxWordCount !== undefined && wordCount > maxWordCount) {
    return {
      valid: false,
      error: `修复后的内容字数 ${wordCount} 超过上限 ${maxWordCount}`,
    }
  }

  if (provider) {
    const [validation] = await batchValidateFixedContent(provider, [rawContent])
    if (validation?.looksLikeRevisionPlan) {
      return { valid: false, error: '修复后的内容疑似修改计划或问题分析，不是正文' }
    }
    if (validation?.containsChecklistArtifacts) {
      return { valid: false, error: '修复后的内容包含预写检查表残留' }
    }
  }

  return { valid: true, content: rawContent }
}
