import { describe, expect, it } from 'vitest'
import { patchChapterSummaryWithFacts } from '../../src/utils/summary-patch.ts'
import type { CanonicalFact } from '../../../src/types/story-state.js'

function buildFact(overrides: Partial<CanonicalFact>): CanonicalFact {
  return {
    id: 'f1',
    subject: '密信',
    attribute: '所在位置',
    value: '官府仓库',
    establishedIn: 2,
    confidence: 'high',
    source: 'chapter_text',
    ...overrides,
  }
}

describe('patchChapterSummaryWithFacts', () => {
  it('appends a superseded note to the matching sentence', () => {
    const summary = '第3章：密信仍藏在主角的书桌抽屉中。主角计划明日动身。'
    const fact = buildFact({
      establishedIn: 2,
      value: '官府仓库',
      supersedes: [{ chapter: 0, oldValue: '书桌抽屉' }],
    })

    const patched = patchChapterSummaryWithFacts(summary, [fact], 0)
    expect(patched).toContain('书桌抽屉')
    expect(patched).toContain('第3章')
    expect(patched).toContain('官府仓库')
  })

  it('does not append a note when the old value is not found', () => {
    const summary = '第3章：主角在京城遭遇旧敌。'
    const fact = buildFact({
      value: '官府仓库',
      supersedes: [{ chapter: 0, oldValue: '书桌抽屉' }],
    })

    const patched = patchChapterSummaryWithFacts(summary, [fact], 0)
    expect(patched).toBe(summary)
  })

  it('does not append the same note twice', () => {
    const summary = '第3章：密信仍藏在主角的书桌抽屉中。'
    const fact = buildFact({
      value: '官府仓库',
      supersedes: [{ chapter: 0, oldValue: '书桌抽屉' }],
    })

    const once = patchChapterSummaryWithFacts(summary, [fact], 0)
    const twice = patchChapterSummaryWithFacts(once, [fact], 0)
    const noteCount = (twice.match(/该事实已于第3章更新/g) ?? []).length
    expect(noteCount).toBe(1)
  })
})
