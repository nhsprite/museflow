import { DAY_FRACTIONS, type DayFraction, type StoryTime } from '../types/story-state.js'

/**
 * 结构化故事时间（B.4）的共享语义：归一化、渲染、单调性比较与年号一致性判定。
 * 全部基于结构化字段（era/year/month/day/dayFraction 枚举），不解析任何自然语言文本；
 * 旧 checkpoint 的自由文本 storyTime 在读取路径归一化为 { freeform: 原文 }。
 */

const DAY_FRACTION_SET: ReadonlySet<string> = new Set(DAY_FRACTIONS)

/** 日内时段的先后序号（用于单调性比较的最细粒度）。 */
const DAY_FRACTION_ORDER: Record<DayFraction, number> = {
  dawn: 0,
  morning: 1,
  noon: 2,
  afternoon: 3,
  evening: 4,
  night: 5,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeIntegerField(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  return value
}

/**
 * 归一化任意来源的 storyTime / handoff.endTime：
 * - 字符串（旧 checkpoint / 模型仍输出自由文本）→ { freeform: 原文 }；空串 → {}；
 * - 对象 → 逐字段校验提取，非法字段丢弃；
 * - 其他 → {}。
 */
export function normalizeStoryTime(value: unknown): StoryTime {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? { freeform: trimmed } : {}
  }
  if (!isRecord(value)) return {}

  const result: StoryTime = {}
  if (isNonEmptyString(value.era)) result.era = value.era.trim()
  const year = normalizeIntegerField(value.year)
  if (year !== undefined) result.year = year
  const month = normalizeIntegerField(value.month)
  if (month !== undefined && month >= 1 && month <= 12) result.month = month
  const day = normalizeIntegerField(value.day)
  if (day !== undefined && day >= 1 && day <= 31) result.day = day
  if (typeof value.dayFraction === 'string' && DAY_FRACTION_SET.has(value.dayFraction)) {
    result.dayFraction = value.dayFraction as DayFraction
  }
  if (isNonEmptyString(value.freeform)) result.freeform = value.freeform.trim()
  return result
}

export function isEmptyStoryTime(value: unknown): boolean {
  const time = normalizeStoryTime(value)
  return (
    time.era === undefined &&
    time.year === undefined &&
    time.month === undefined &&
    time.day === undefined &&
    time.dayFraction === undefined &&
    time.freeform === undefined
  )
}

const DAY_FRACTION_LABELS: Record<DayFraction, string> = {
  dawn: '黎明',
  morning: '上午',
  noon: '正午',
  afternoon: '午后',
  evening: '傍晚',
  night: '夜晚',
}

/** 渲染为提示词可读文本：优先结构化字段组合，freeform 作为补充或兜底。 */
export function formatStoryTime(value: unknown): string {
  const time = normalizeStoryTime(value)
  const parts: string[] = []
  if (time.era !== undefined) parts.push(time.era)
  if (time.year !== undefined) parts.push(`${time.year}年`)
  if (time.month !== undefined) parts.push(`${time.month}月`)
  if (time.day !== undefined) parts.push(`${time.day}日`)
  if (time.dayFraction !== undefined) parts.push(DAY_FRACTION_LABELS[time.dayFraction])
  const structured = parts.join('')
  if (structured.length > 0) {
    return time.freeform !== undefined ? `${structured}（${time.freeform}）` : structured
  }
  return time.freeform ?? ''
}

function hasStructuredFields(time: StoryTime): boolean {
  return (
    time.era !== undefined ||
    time.year !== undefined ||
    time.month !== undefined ||
    time.day !== undefined ||
    time.dayFraction !== undefined
  )
}

export type StoryTimeComparison = 'earlier' | 'same' | 'later' | 'incomparable'

/**
 * 单调性比较：curr 相对 prev 的时间方向。
 * 只比较双方都存在的字段，按 year → month → day → dayFraction 粒度逐级比较；
 * era 不同无法定序（由年号一致性检查单独报告）；任一侧只有 freeform 时不可比较。
 */
export function compareStoryTime(prevValue: unknown, currValue: unknown): StoryTimeComparison {
  const prev = normalizeStoryTime(prevValue)
  const curr = normalizeStoryTime(currValue)
  if (!hasStructuredFields(prev) || !hasStructuredFields(curr)) return 'incomparable'
  if (prev.era !== undefined && curr.era !== undefined && prev.era !== curr.era) {
    return 'incomparable'
  }

  const levels: Array<[number | undefined, number | undefined]> = [
    [prev.year, curr.year],
    [prev.month, curr.month],
    [prev.day, curr.day],
    [
      prev.dayFraction !== undefined ? DAY_FRACTION_ORDER[prev.dayFraction] : undefined,
      curr.dayFraction !== undefined ? DAY_FRACTION_ORDER[curr.dayFraction] : undefined,
    ],
  ]
  for (const [before, after] of levels) {
    if (before === undefined || after === undefined) continue
    if (after < before) return 'earlier'
    if (after > before) return 'later'
  }
  return 'same'
}

/**
 * 年号一致性（B.4）：本章断言绝对日期（era+year）与运行中的故事年份冲突。
 * 仅当两侧都携带 era 且不一致时判定冲突；era 相同而年份回退由单调性检查负责。
 * 注意：校验只作用于 storyTime 通道本身——文中档案/公文的历史日期不进入该通道。
 */
export function hasStoryTimeEraConflict(prevValue: unknown, currValue: unknown): boolean {
  const prev = normalizeStoryTime(prevValue)
  const curr = normalizeStoryTime(currValue)
  return (
    prev.era !== undefined &&
    curr.era !== undefined &&
    prev.year !== undefined &&
    curr.year !== undefined &&
    prev.era !== curr.era
  )
}
