import { describe, expect, it } from 'vitest'
import { buildNextChapterBoundaryHint } from '../../src/utils/outline-boundary.ts'

describe('buildNextChapterBoundaryHint integration with chapter agent outline', () => {
  it('injects boundary hint into formatted outline for current chapter', () => {
    const outline = [
      { number: 1, title: '启程', description: '主角离开家乡。' },
      { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
    ]

    const hint = buildNextChapterBoundaryHint(outline, 0)

    expect(hint).toContain('第2章')
    expect(hint).toContain('遇敌')
    expect(hint).toContain('后续章节边界提示')
    expect(hint).toContain('不要把后续章节的核心事件提前解决')
  })

  it('detects cross-chapter conflict and warns not to resolve early', () => {
    const outline = [
      { number: 29, title: '真假美猴王', description: '六耳猕猴伏法。' },
      { number: 30, title: '三界求援', description: '如来佛祖现身辨别六耳猕猴。' },
    ]

    const hint = buildNextChapterBoundaryHint(outline, 0)

    expect(hint).toContain('严重跨章节边界冲突')
    expect(hint).toContain('第29章')
    expect(hint).toContain('伏法')
    expect(hint).toContain('辨别')
    expect(hint).toContain('不得把"辨别"涉及的事件彻底解决')
  })

  it('returns empty string for last chapter', () => {
    const outline = [
      { number: 1, title: '开始', description: '开始。' },
      { number: 2, title: '结束', description: '结束。' },
    ]

    expect(buildNextChapterBoundaryHint(outline, 1)).toBe('')
  })
})
