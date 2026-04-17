import { describe, expect, it } from 'vitest'

import { getCurrentChapterDisplayNumber, toDisplayChapterNumber } from '../../src/utils/chapter-display.ts'

describe('chapter display helpers', () => {
  it('converts internal indexes to display chapter numbers', () => {
    expect(toDisplayChapterNumber(0)).toBe(1)
    expect(toDisplayChapterNumber(1)).toBe(2)
  })

  it('clamps the current chapter display when the story is complete', () => {
    expect(getCurrentChapterDisplayNumber(0, 3)).toBe(1)
    expect(getCurrentChapterDisplayNumber(3, 3)).toBe(3)
    expect(getCurrentChapterDisplayNumber(0, 0)).toBe(0)
  })
})
