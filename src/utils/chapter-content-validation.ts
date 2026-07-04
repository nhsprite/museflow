import { countChineseWords } from './text.js'
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
  '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '百': 100, '千': 1000, '万': 10000,
}

/** 章节标题中允许的数字字符类（中文数字 + 阿拉伯数字）。 */
const CHAPTER_NUMERAL_CLASS = '[一二三四五六七八九十百千万零\\d]+'

/**
 * 通用章节标题识别正则。
 * 支持：# 第X章、# 第X部分、# X. 标题、# 章节X
 * 章节号后的分隔符（空格/冒号）为可选，以兼容行尾被 trim 的情况。
 */
export const CHAPTER_HEADING_PATTERN = new RegExp(
  `^(#{1,2}\\s+第\\s*${CHAPTER_NUMERAL_CLASS}\\s*章[\\s:：]?|` +
  `#{1,2}\\s+第\\s*${CHAPTER_NUMERAL_CLASS}\\s*部分[\\s:：]?|` +
  `#{1,2}\\s+${CHAPTER_NUMERAL_CLASS}[.、]\\s+|` +
  `#{1,2}\\s+章节?\\s*${CHAPTER_NUMERAL_CLASS})`,
  'm'
)

/**
 * 严格“第X章”标题识别正则，用于截断预写检查表残留。
 */
export const CHAPTER_TITLE_ONLY_PATTERN = new RegExp(
  `^(#{1,2}\\s+第\\s*${CHAPTER_NUMERAL_CLASS}\\s*章[\\s:：]?)`,
  'm'
)

export function parseChineseNumber(str: string): number | null {
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
    if (CHAPTER_HEADING_PATTERN.test(trimmed)) {
      return trimmed
    }
  }
  return null
}

export function extractChapterNumber(heading: string): number | null {
  const match = heading.match(new RegExp(`第\\s*(${CHAPTER_NUMERAL_CLASS})\\s*章`))
  if (match && match[1]) {
    const arabic = parseInt(match[1], 10)
    if (!isNaN(arabic)) return arabic
    return parseChineseNumber(match[1])
  }
  return null
}

export interface ChapterHeadingCorrection {
  corrected: string
  originalFoundNumber: number
  reason: string
}

/**
 * 当模型把本章内容误标为下一章时，曾经尝试自动修正章节标题。
 * 该入口保留给调用方，但在没有结构化判据前不再自动修正。
 */
export function tryCorrectOffByOneChapterHeading(
  rawContent: string,
  chapterIndex: number,
  currentOutlineDescription: string,
  nextOutlineDescription: string | undefined,
  minOverlapRatio = 1.5,
  minCurrentOverlapWithoutNext = 5
): ChapterHeadingCorrection | null {
  void rawContent
  void chapterIndex
  void currentOutlineDescription
  void nextOutlineDescription
  void minOverlapRatio
  void minCurrentOverlapWithoutNext
  return null
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
