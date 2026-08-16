import { describe, expect, it } from 'vitest'
import {
  compareStoryTime,
  formatStoryTime,
  hasStoryTimeEraConflict,
  isEmptyStoryTime,
  normalizeStoryTime,
} from '../../src/utils/story-time.js'

describe('normalizeStoryTime', () => {
  it('旧格式自由文本迁移为 { freeform: 原文 }', () => {
    expect(normalizeStoryTime('贞观十八年春')).toEqual({ freeform: '贞观十八年春' })
    expect(normalizeStoryTime('  第三日黄昏  ')).toEqual({ freeform: '第三日黄昏' })
  })

  it('空字符串与非法输入归一化为空对象', () => {
    expect(normalizeStoryTime('')).toEqual({})
    expect(normalizeStoryTime('   ')).toEqual({})
    expect(normalizeStoryTime(undefined)).toEqual({})
    expect(normalizeStoryTime(null)).toEqual({})
    expect(normalizeStoryTime(42)).toEqual({})
  })

  it('结构化对象逐字段校验提取，非法字段丢弃', () => {
    expect(
      normalizeStoryTime({
        era: '贞观',
        year: 18,
        month: 3,
        day: 15,
        dayFraction: 'evening',
        freeform: '黄昏时分',
      })
    ).toEqual({
      era: '贞观',
      year: 18,
      month: 3,
      day: 15,
      dayFraction: 'evening',
      freeform: '黄昏时分',
    })

    expect(
      normalizeStoryTime({ era: '  ', year: 1.5, month: 13, day: 0, dayFraction: 'dusk' })
    ).toEqual({})
  })
})

describe('isEmptyStoryTime / formatStoryTime', () => {
  it('空对象与空字符串视为空', () => {
    expect(isEmptyStoryTime({})).toBe(true)
    expect(isEmptyStoryTime('')).toBe(true)
    expect(isEmptyStoryTime({ freeform: '傍晚' })).toBe(false)
    expect(isEmptyStoryTime({ year: 18 })).toBe(false)
  })

  it('结构化字段组合渲染，freeform 作为补充', () => {
    expect(formatStoryTime({ era: '贞观', year: 18, month: 3, day: 2 })).toBe('贞观18年3月2日')
    expect(formatStoryTime({ year: 18, dayFraction: 'night' })).toBe('18年夜晚')
    expect(formatStoryTime({ era: '贞观', year: 18, freeform: '初春' })).toBe('贞观18年（初春）')
    expect(formatStoryTime({ freeform: '第三日黄昏' })).toBe('第三日黄昏')
    expect(formatStoryTime({})).toBe('')
  })

  it('旧格式字符串直接渲染原文', () => {
    expect(formatStoryTime('贞观十八年春')).toBe('贞观十八年春')
  })
})

describe('compareStoryTime 单调性', () => {
  it('同年 finer 粒度回退判为 earlier', () => {
    expect(compareStoryTime({ year: 18, month: 5 }, { year: 18, month: 3 })).toBe('earlier')
    expect(compareStoryTime({ year: 18 }, { year: 3 })).toBe('earlier')
    expect(
      compareStoryTime({ day: 2, dayFraction: 'night' }, { day: 2, dayFraction: 'dawn' })
    ).toBe('earlier')
  })

  it('时间前进或持平不判回归', () => {
    expect(compareStoryTime({ year: 18 }, { year: 19 })).toBe('later')
    expect(compareStoryTime({ year: 18, month: 3 }, { year: 18, month: 3 })).toBe('same')
    // 一侧信息更细不构成回归
    expect(compareStoryTime({ year: 18, month: 5 }, { year: 18 })).toBe('same')
    expect(compareStoryTime({ year: 18 }, { year: 18, month: 1 })).toBe('same')
  })

  it('freeform 兜底或 era 不一致时不可比较（不定序）', () => {
    expect(compareStoryTime({ freeform: '三日后' }, { year: 18 })).toBe('incomparable')
    expect(compareStoryTime({ year: 18 }, { freeform: '次日' })).toBe('incomparable')
    expect(compareStoryTime({ era: '贞观', year: 18 }, { era: '元狩', year: 1 })).toBe(
      'incomparable'
    )
  })
})

describe('hasStoryTimeEraConflict 年号一致性', () => {
  it('运行中年号与章节断言的绝对日期年号不同则冲突', () => {
    expect(hasStoryTimeEraConflict({ era: '贞观', year: 18 }, { era: '元狩', year: 1 })).toBe(true)
  })

  it('同年号（年份回退属单调性问题）或缺少年号/年份不冲突', () => {
    expect(hasStoryTimeEraConflict({ era: '贞观', year: 18 }, { era: '贞观', year: 3 })).toBe(false)
    expect(hasStoryTimeEraConflict({ era: '贞观', year: 18 }, { era: '元狩' })).toBe(false)
    expect(hasStoryTimeEraConflict({ year: 18 }, { era: '元狩', year: 1 })).toBe(false)
    expect(hasStoryTimeEraConflict({ freeform: '某日' }, { era: '元狩', year: 1 })).toBe(false)
  })
})
