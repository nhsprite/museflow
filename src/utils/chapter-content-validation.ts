import { countChineseWords } from './text.js'

export interface ValidationOptions {
  chapterIndex: number
  minWordCount?: number
  maxWordCount?: number
}

export interface ValidationResult {
  valid: boolean
  content?: string
  error?: string
}

const CHINESE_NUMERALS: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '百': 100, '千': 1000, '万': 10000,
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

function extractChapterNumber(heading: string): number | null {
  const match = heading.match(/第\s*([一二三四五六七八九十百千万\d]+)\s*章/)
  if (match && match[1]) {
    const arabic = parseInt(match[1], 10)
    if (!isNaN(arabic)) return arabic
    return parseChineseNumber(match[1])
  }
  return null
}

function findChapterHeading(text: string): string | null {
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^#{1,2}\s+第\s*[一二三四五六七八九十百千万\d]+\s*章/.test(trimmed)) {
      return trimmed
    }
  }
  return null
}

function looksLikeRevisionPlan(text: string): boolean {
  const indicators = [
    /问题分析\s*[：:]/,
    /修复建议\s*[：:]/,
    /修改建议\s*[：:]/,
    /改进建议\s*[：:]/,
    /问题梳理\s*[：:]/,
    /需要修改\s*[：:]/,
    /应该.*增加/,
    /应该.*补充/,
    /可以.*加入/,
    /可以.*修改/,
    /需要.*重写/,
    /建议.*调整/,
    /^\s*1\.\s+/m,
    /^\s*2\.\s+/m,
  ]

  const indicatorHits = indicators.filter(pattern => pattern.test(text)).length
  if (indicatorHits >= 2) return true

  const modalMatches = text.match(/(应该|可以|需要|建议|必须|应当|最好)/g) ?? []
  const wordCount = countChineseWords(text)
  if (wordCount === 0) return false
  const modalDensity = modalMatches.length / wordCount
  if (modalDensity > 0.05) return true

  return false
}

function containsChecklistArtifacts(text: string): boolean {
  const artifacts = [
    /预写对齐检查表/,
    /自检清单/,
    /\|\s*检查项\s*\|/,
    /\|\s*来源\s*\|/,
    /\[\s*x?\s*\]\s*大纲中的每个情节点/,
    /\[\s*x?\s*\]\s*没有发现与大纲矛盾/,
  ]
  return artifacts.some(pattern => pattern.test(text))
}

export function validateFixedChapterContent(
  rawContent: string,
  options: ValidationOptions
): ValidationResult {
  const { chapterIndex, minWordCount = 1500, maxWordCount } = options

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

  if (looksLikeRevisionPlan(rawContent)) {
    return { valid: false, error: '修复后的内容疑似修改计划或问题分析，不是正文' }
  }

  if (containsChecklistArtifacts(rawContent)) {
    return { valid: false, error: '修复后的内容包含预写检查表残留' }
  }

  return { valid: true, content: rawContent }
}
