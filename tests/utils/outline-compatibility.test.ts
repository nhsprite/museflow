import { describe, expect, it } from 'vitest'
import { findRedundantOutlineEvents, buildNextChapterBoundaryHint } from '../../src/utils/outline-compatibility.ts'

describe('findRedundantOutlineEvents', () => {
  it('detects when current outline repeats resolution after previous terminal event', () => {
    const outline = [
      { number: 29, title: '真假美猴王', description: '六耳猕猴伏法，真宝玉获救。' },
      { number: 30, title: '三界求援', description: '各路神仙齐聚辨别六耳猕猴真伪。' },
    ]

    const redundant = findRedundantOutlineEvents(outline, 1)

    expect(redundant).toHaveLength(1)
    expect(redundant[0]!.previousKeyword).toBe('伏法')
    expect(redundant[0]!.currentKeyword).toBe('辨别')
  })

  it('detects redundant "伏妖" event when previous chapter already sealed the entity', () => {
    const outline = [
      { number: 29, title: '真假美猴王', description: '六耳猕猴被封入锦囊，无法动弹。' },
      { number: 30, title: '三界求援', description: '如来佛祖以金钵伏妖，辨别真伪。' },
    ]

    const redundant = findRedundantOutlineEvents(outline, 1)

    expect(redundant).toHaveLength(1)
    expect(redundant[0]!.previousKeyword).toBe('封入')
    expect(redundant[0]!.currentKeyword).toBe('辨别')
  })

  it('returns empty when chapters describe different events', () => {
    const outline = [
      { number: 1, title: '启程', description: '主角离开家乡。' },
      { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
    ]

    expect(findRedundantOutlineEvents(outline, 1)).toHaveLength(0)
  })

  it('returns empty for first chapter', () => {
    const outline = [
      { number: 1, title: '启程', description: '主角离开家乡。' },
    ]

    expect(findRedundantOutlineEvents(outline, 0)).toHaveLength(0)
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
  })

  it('warns when next chapter resolves same event', () => {
    const outline = [
      { number: 29, title: '真假美猴王', description: '六耳猕猴伏法。' },
      { number: 30, title: '三界求援', description: '各路神仙齐聚辨别六耳猕猴真伪。' },
    ]

    const hint = buildNextChapterBoundaryHint(outline, 0)

    expect(hint).toContain('不得在本章彻底解决')
    expect(hint).toContain('留给第30章处理')
  })

  it('returns empty string for last chapter', () => {
    const outline = [
      { number: 1, title: '第一章', description: '开始。' },
      { number: 2, title: '第二章', description: '结束。' },
    ]

    expect(buildNextChapterBoundaryHint(outline, 1)).toBe('')
  })
})
