import { describe, expect, it } from 'vitest'
import {
  buildOutlineBridgeHint,
  buildNextChapterBoundaryHint,
  shouldForceTemporaryReplan,
} from '../../src/utils/outline-boundary.ts'

describe('buildOutlineBridgeHint', () => {
  it('always returns empty string (no keyword-based detection)', () => {
    const outline = [
      { number: 29, title: '真假美猴王', description: '六耳猕猴伏法，真宝玉获救。' },
      { number: 30, title: '三界求援', description: '如来佛祖现身，以无上神通辨别六耳猕猴。' },
    ]

    expect(buildOutlineBridgeHint(outline, 0)).toBe('')
    expect(buildOutlineBridgeHint(outline, 1)).toBe('')
  })
})

describe('buildNextChapterBoundaryHint', () => {
  it('includes next chapter title and description', () => {
    const outline = [
      { number: 29, title: '真假美猴王', description: '六耳猕猴伏法。' },
      { number: 30, title: '三界求援', description: '各路神仙齐聚辨别真伪。' },
    ]

    const hint = buildNextChapterBoundaryHint(outline, 0)

    expect(hint).toContain('第30章')
    expect(hint).toContain('三界求援')
    expect(hint).toContain('辨别真伪')
    expect(hint).toContain('不要把后续章节的核心事件提前解决')
  })

  it('returns empty string for last chapter', () => {
    const outline = [
      { number: 1, title: '第一章', description: '开始。' },
      { number: 2, title: '第二章', description: '结束。' },
    ]

    expect(buildNextChapterBoundaryHint(outline, 1)).toBe('')
  })
})

describe('shouldForceTemporaryReplan', () => {
  it('always returns false (no keyword-based detection)', () => {
    const outline = [
      { number: 29, title: '真假美猴王', description: '六耳猕猴伏法，真宝玉获救。' },
      { number: 30, title: '三界求援', description: '如来佛祖现身，以无上神通辨别六耳猕猴。' },
    ]

    expect(shouldForceTemporaryReplan(outline, 0)).toBe(false)
    expect(shouldForceTemporaryReplan(outline, 1)).toBe(false)
  })
})
