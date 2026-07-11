import { describe, expect, it } from 'vitest'
import {
  classifyForeshadows,
  isValidForeshadowDeadline,
} from '../../src/story-memory/foreshadow-policy.js'
import type { ForeshadowItem } from '../../src/types/foreshadow.js'

function item(overrides: Partial<ForeshadowItem> = {}): ForeshadowItem {
  return {
    id: 'fs-default',
    text: '结构化伏笔',
    expectedFulfillChapter: 5,
    createdAt: 0,
    createdAtChapter: 1,
    status: 'planted',
    isExplicit: true,
    required: true,
    ...overrides,
  }
}

describe('foreshadow deadline policy', () => {
  it('accepts only null or a 1-based deadline after the introduction chapter', () => {
    expect(isValidForeshadowDeadline(9, 0)).toBe(false)
    expect(isValidForeshadowDeadline(9, 10)).toBe(false)
    expect(isValidForeshadowDeadline(9, 11)).toBe(true)
    expect(isValidForeshadowDeadline(9, null)).toBe(true)
    expect(isValidForeshadowDeadline(9, 11.5)).toBe(false)
  })

  it('separates required overdue, optional, invalid, and fulfilled items', () => {
    const buckets = classifyForeshadows(
      [
        item({ id: 'required-overdue', expectedFulfillChapter: 5 }),
        item({ id: 'optional-overdue', expectedFulfillChapter: 5, required: false }),
        item({ id: 'invalid', expectedFulfillChapter: 0 }),
        item({ id: 'fulfilled', expectedFulfillChapter: 5, fulfilledChapter: 6 }),
      ],
      10
    )

    expect(buckets.overdueRequired.map((entry) => entry.id)).toEqual(['required-overdue'])
    expect(buckets.optional.map((entry) => entry.id)).toEqual(['optional-overdue'])
    expect(buckets.invalid.map((entry) => entry.id)).toEqual(['invalid'])
    expect(buckets.dueRequired).toEqual([])
    expect(buckets.normalRequired).toEqual([])
  })
})
