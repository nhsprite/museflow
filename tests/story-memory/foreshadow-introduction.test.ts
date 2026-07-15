import { describe, expect, it } from 'vitest'
import type { StoryEvent } from '../../src/types/story-memory.js'
import {
  isProjectableForeshadowIntroduction,
  isValidForeshadowDeadline,
} from '../../src/story-memory/foreshadow-introduction.js'

type ForeshadowIntroduceEvent = Extract<StoryEvent, { type: 'foreshadow-introduce' }>

function introduction(expectedFulfillChapter: number | null): ForeshadowIntroduceEvent {
  return {
    id: 'introduce-fs-record',
    type: 'foreshadow-introduce',
    foreshadowId: 'fs-record',
    resolutionPolicy: expectedFulfillChapter === null ? 'should_resolve' : 'must_resolve',
    expectedFulfillChapter,
    chapterIndex: 2,
    source: 'outline',
  }
}

describe('foreshadow introduction projectability', () => {
  it('requires a numeric deadline to be after the introduction chapter', () => {
    expect(isValidForeshadowDeadline(2, 3)).toBe(false)
    expect(isValidForeshadowDeadline(2, 4)).toBe(true)
    expect(isValidForeshadowDeadline(2, null)).toBe(true)
  })

  it('applies the shared deadline predicate to introduction events', () => {
    expect(isProjectableForeshadowIntroduction(introduction(3))).toBe(false)
    expect(isProjectableForeshadowIntroduction(introduction(4))).toBe(true)
    expect(isProjectableForeshadowIntroduction(introduction(null))).toBe(true)
  })
})
