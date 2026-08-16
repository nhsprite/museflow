/**
 * 中文数字解析工具。
 *
 * 供章节标题识别（chapter-content-validation）与正文体例检查（prose-hygiene）
 * 共享，避免两个模块互相依赖形成循环引用。
 */

const CHINESE_NUMERALS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  百: 100,
  千: 1000,
  万: 10000,
}

/** 章节标题中允许的数字字符类（中文数字 + 阿拉伯数字）。 */
export const CHAPTER_NUMERAL_CLASS = '[一二三四五六七八九十百千万零\\d]+'

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
