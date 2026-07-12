import { describe, it, expect } from 'vitest'
import {
  generateForeshadowConstraints,
  formatExpectedFulfillChapter,
} from '../../src/utils/foreshadow-constraints.js'
import type { ForeshadowItem } from '../../src/types/foreshadow.js'

function makeForeshadow(overrides: Partial<ForeshadowItem> = {}): ForeshadowItem {
  return {
    id: 'fs-1',
    text: '神秘信件的来历',
    expectedFulfillChapter: 10,
    createdAt: 0,
    createdAtChapter: 2,
    status: 'planted',
    isExplicit: true,
    required: true,
    ...overrides,
  }
}

describe('generateForeshadowConstraints', () => {
  it('keeps the constraint alive across chapters until the expected fulfillment', () => {
    const stack = [makeForeshadow({ createdAtChapter: 2, expectedFulfillChapter: 10 })]

    expect(generateForeshadowConstraints(stack, 2)).toHaveLength(1)
    expect(generateForeshadowConstraints(stack, 5)).toHaveLength(1)
    expect(generateForeshadowConstraints(stack, 9)).toHaveLength(1)
  })

  it('expires at the expected fulfillment chapter and after fulfillment', () => {
    const stack = [makeForeshadow({ createdAtChapter: 2, expectedFulfillChapter: 10 })]
    expect(generateForeshadowConstraints(stack, 10)).toHaveLength(0)

    const fulfilled = [makeForeshadow({ fulfilledChapter: 5 })]
    expect(generateForeshadowConstraints(fulfilled, 4)).toHaveLength(0)
  })

  it('ignores foreshadows planted in later chapters', () => {
    const stack = [makeForeshadow({ createdAtChapter: 8, expectedFulfillChapter: 10 })]
    expect(generateForeshadowConstraints(stack, 3)).toHaveLength(0)
  })

  it('carries a stable structured id and renders an open deadline as 全书结尾', () => {
    const stack = [
      makeForeshadow({ id: 'fs-open', expectedFulfillChapter: Number.MAX_SAFE_INTEGER }),
    ]
    const [constraint] = generateForeshadowConstraints(stack, 3)
    expect(constraint?.id).toBe('foreshadow-boundary:fs-open')
    expect(constraint?.text).toContain('全书结尾')
    expect(constraint?.text).not.toContain('9007199254740991')
  })
})

describe('formatExpectedFulfillChapter', () => {
  it('renders the sentinel as 全书结尾 and numbers as chapter references', () => {
    expect(formatExpectedFulfillChapter(Number.MAX_SAFE_INTEGER)).toBe('全书结尾')
    expect(formatExpectedFulfillChapter(12)).toBe('第12章')
  })
})
