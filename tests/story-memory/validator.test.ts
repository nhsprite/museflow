import { describe, it, expect } from 'vitest'
import { validateChapterEvents } from '../../src/story-memory/validator.js'
import { createEmptyStoryMemory, applyEvents } from '../../src/story-memory/projector.js'
import type { ChapterPlan } from '../../src/agents/types.js'

function createEmptyChapterPlan(
  chapterIndex: number,
  overrides: Partial<ChapterPlan> = {}
): ChapterPlan {
  return {
    chapterIndex,
    sections: [],
    timeline: [],
    outlineCheck: [],
    expectedEvents: [],
    claimedBeatIds: [],
    fulfilledForeshadowIds: [],
    introducedForeshadowIds: [],
    resolvedTaskIds: [],
    createdTaskIds: [],
    ...overrides,
  }
}

describe('validateChapterEvents', () => {
  it('detects missing expected event', () => {
    const memory = createEmptyStoryMemory()
    const plan = createEmptyChapterPlan(1, {
      expectedEvents: [
        {
          id: 'e1',
          type: 'character-location',
          characterId: 'c-1',
          locationId: 'l-1',
          chapterIndex: 1,
          source: 'chapter',
        },
      ],
    })
    const result = validateChapterEvents(memory, 1, plan, [])
    expect(result.missingEvents).toHaveLength(1)
  })

  it('detects overdue required foreshadow', () => {
    let memory = createEmptyStoryMemory()
    memory = applyEvents(memory, [
      {
        id: 'e1',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-1',
        expectedFulfillChapter: 3,
        chapterIndex: 1,
        source: 'outline',
      },
    ])
    memory.foreshadows['f-1']!.required = true

    const plan = createEmptyChapterPlan(5)
    const result = validateChapterEvents(memory, 5, plan, [])
    expect(result.overdueForeshadows).toContain('f-1')
  })

  it('detects false foreshadow fulfillment claims', () => {
    const memory = createEmptyStoryMemory()
    const plan = createEmptyChapterPlan(2, {
      fulfilledForeshadowIds: ['f-1'],
    })
    const result = validateChapterEvents(memory, 2, plan, [])
    expect(result.falseFulfillments).toContain('f-1')
  })

  it('detects claimed but unproven beats', () => {
    const memory = createEmptyStoryMemory()
    const plan = createEmptyChapterPlan(2, {
      claimedBeatIds: ['a1-b1'],
    })
    const result = validateChapterEvents(memory, 2, plan, [])
    expect(result.claimedButUnprovenBeats).toContain('a1-b1')
  })

  it('detects state conflicts in same chapter', () => {
    const memory = createEmptyStoryMemory()
    const plan = createEmptyChapterPlan(1)
    const actualEvents = [
      {
        id: 'e1',
        type: 'character-location' as const,
        characterId: 'c-1',
        locationId: 'l-1',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
      {
        id: 'e2',
        type: 'character-location' as const,
        characterId: 'c-1',
        locationId: 'l-2',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
    ]
    const result = validateChapterEvents(memory, 1, plan, actualEvents)
    expect(result.stateConflicts).toHaveLength(1)
  })

  it('does not report duplicate same-value state events as conflicts', () => {
    const memory = createEmptyStoryMemory()
    const plan = createEmptyChapterPlan(1)
    const actualEvents = [
      {
        id: 'e1',
        type: 'character-location' as const,
        characterId: 'c-1',
        locationId: 'l-1',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
      {
        id: 'e2',
        type: 'character-location' as const,
        characterId: 'c-1',
        locationId: 'l-1',
        chapterIndex: 1,
        source: 'outline' as const,
      },
    ]
    const result = validateChapterEvents(memory, 1, plan, actualEvents)
    expect(result.stateConflicts).toHaveLength(0)
  })
})
