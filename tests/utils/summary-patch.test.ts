import { describe, expect, it } from 'vitest'
import { patchChapterSummaryWithFacts } from '../../src/utils/summary-patch.ts'
import type { CanonicalFact } from '../../src/types/story-state.js'

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
  it('does not patch summaries by matching old fact prose', () => {
    const summary = '第3章：密信仍藏在主角的书桌抽屉中。主角计划明日动身。'
    const fact = buildFact({
      establishedIn: 2,
      value: '官府仓库',
      supersedes: [{ chapter: 0, oldValue: '书桌抽屉' }],
    })

    const patched = patchChapterSummaryWithFacts(summary, [fact], 0)
    expect(patched).toBe(summary)
  })

  it('keeps summaries unchanged when the old value is not present', () => {
    const summary = '第3章：主角在京城遭遇旧敌。'
    const fact = buildFact({
      value: '官府仓库',
      supersedes: [{ chapter: 0, oldValue: '书桌抽屉' }],
    })

    const patched = patchChapterSummaryWithFacts(summary, [fact], 0)
    expect(patched).toBe(summary)
  })

  it('keeps repeated calls idempotent', () => {
    const summary = '第3章：密信仍藏在主角的书桌抽屉中。'
    const fact = buildFact({
      value: '官府仓库',
      supersedes: [{ chapter: 0, oldValue: '书桌抽屉' }],
    })

    const once = patchChapterSummaryWithFacts(summary, [fact], 0)
    const twice = patchChapterSummaryWithFacts(once, [fact], 0)
    expect(twice).toBe(summary)
  })
})
