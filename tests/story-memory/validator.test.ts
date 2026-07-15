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

  it('requires paragraph evidence for actual story events when chapter content is provided', () => {
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
    ]

    const result = validateChapterEvents(memory, 1, plan, actualEvents, {
      chapterContent: '# 第一章\n\n角色走进教室。',
      requireEvidence: true,
    })

    expect(result.eventsMissingEvidence).toHaveLength(1)
    expect(result.eventsMissingEvidence[0]?.id).toBe('e1')
  })

  it('rejects paragraph evidence that points outside the chapter content', () => {
    const memory = createEmptyStoryMemory()
    const plan = createEmptyChapterPlan(1, {
      claimedBeatIds: ['beat-1'],
    })
    const actualEvents = [
      {
        id: 'e1',
        type: 'plot-advance' as const,
        plotId: 'plot-1',
        beatId: 'beat-1',
        chapterIndex: 1,
        source: 'chapter' as const,
        evidence: { paragraphIndex: 3 },
      },
    ]

    const result = validateChapterEvents(memory, 1, plan, actualEvents, {
      chapterContent: '# 第一章\n\n角色走进教室。',
      requireEvidence: true,
    })

    expect(result.eventsWithInvalidEvidence).toHaveLength(1)
    expect(result.eventsWithInvalidEvidence[0]?.id).toBe('e1')
    expect(result.claimedButUnprovenBeats).toContain('beat-1')
  })

  it('uses evidenced current chapter events as proof for claimed beats', () => {
    const memory = createEmptyStoryMemory()
    const plan = createEmptyChapterPlan(1, {
      claimedBeatIds: ['beat-1'],
    })
    const actualEvents = [
      {
        id: 'e1',
        type: 'plot-advance' as const,
        plotId: 'plot-1',
        beatId: 'beat-1',
        chapterIndex: 1,
        source: 'chapter' as const,
        evidence: { paragraphIndex: 1 },
      },
    ]

    const result = validateChapterEvents(memory, 1, plan, actualEvents, {
      chapterContent: '# 第一章\n\n角色终于离开。',
      requireEvidence: true,
    })

    expect(result.eventsMissingEvidence).toEqual([])
    expect(result.eventsWithInvalidEvidence).toEqual([])
    expect(result.claimedButUnprovenBeats).toEqual([])
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

  it('does not report a stale required flag when policy is non-mandatory', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e-soft',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-soft',
        expectedFulfillChapter: 3,
        chapterIndex: 1,
        source: 'outline',
      },
    ])
    memory.foreshadows['f-soft']!.resolutionPolicy = 'should_resolve'
    memory.foreshadows['f-soft']!.required = true

    const result = validateChapterEvents(memory, 5, createEmptyChapterPlan(5), [])

    expect(result.overdueForeshadows).not.toContain('f-soft')
    expect(result.unfulfilledRequiredForeshadows).not.toContain('f-soft')
  })

  it('rejects a foreshadow deadline that is not after the introduction chapter', () => {
    const memory = createEmptyStoryMemory()
    const plan = createEmptyChapterPlan(9)
    const invalidEvent = {
      id: 'e-invalid-deadline',
      type: 'foreshadow-introduce' as const,
      foreshadowId: 'f-invalid',
      expectedFulfillChapter: 0,
      chapterIndex: 9,
      source: 'chapter' as const,
    }

    const result = validateChapterEvents(memory, 9, plan, [invalidEvent])

    expect(result.eventsWithInvalidForeshadowDeadline).toEqual([invalidEvent])
    expect(result.actualEvents).toEqual([invalidEvent])
  })

  it('detects false foreshadow fulfillment claims', () => {
    const memory = createEmptyStoryMemory()
    const plan = createEmptyChapterPlan(2, {
      fulfilledForeshadowIds: ['f-1'],
    })
    const result = validateChapterEvents(memory, 2, plan, [])
    expect(result.falseFulfillments).toContain('f-1')
  })

  it('treats canonical and alias fulfillment claims as one satisfied obligation', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'introduce-early',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-early',
        text: 'canonical planted text',
        resolutionPolicy: 'must_resolve',
        expectedFulfillChapter: 3,
        chapterIndex: 0,
        source: 'outline',
      },
      {
        id: 'introduce-late',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-late',
        text: 'duplicate planted text',
        resolutionPolicy: 'must_resolve',
        expectedFulfillChapter: 3,
        chapterIndex: 1,
        source: 'outline',
      },
      {
        id: 'merge',
        type: 'foreshadow-merge',
        canonicalForeshadowId: 'fs-early',
        duplicateForeshadowId: 'fs-late',
        reason: 'same structured obligation',
        chapterIndex: 1,
        source: 'outline',
      },
    ])
    const plan = createEmptyChapterPlan(2, {
      fulfilledForeshadowIds: ['fs-late', 'fs-early'],
      expectedEvents: [
        {
          id: 'expected-canonical',
          type: 'foreshadow-fulfill',
          foreshadowId: 'fs-early',
          chapterIndex: 2,
          source: 'chapter',
        },
      ],
    })
    const actualEvents = [
      {
        id: 'actual-alias',
        type: 'foreshadow-fulfill' as const,
        foreshadowId: 'fs-late',
        chapterIndex: 2,
        source: 'chapter' as const,
      },
    ]

    const result = validateChapterEvents(memory, 2, plan, actualEvents)

    expect(result.missingEvents).toEqual([])
    expect(result.unexpectedEvents).toEqual([])
    expect(result.falseFulfillments).toEqual([])
    expect(result.overdueForeshadows).toEqual([])
    expect(result.unfulfilledRequiredForeshadows).toEqual([])
  })

  it('detects claimed but unproven beats', () => {
    const memory = createEmptyStoryMemory()
    const plan = createEmptyChapterPlan(2, {
      claimedBeatIds: ['a1-b1'],
    })
    const result = validateChapterEvents(memory, 2, plan, [])
    expect(result.claimedButUnprovenBeats).toContain('a1-b1')
  })

  it('does not flag legitimate intra-chapter movement as state conflict', () => {
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
    expect(result.stateConflicts).toHaveLength(0)
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

  describe('final-state declarations', () => {
    const itemLocationEvent = (id: string, locationId: string, chapterIndex = 1) => ({
      id,
      type: 'item-location' as const,
      itemId: 'i-box',
      holderId: null,
      locationId,
      chapterIndex,
      source: 'chapter' as const,
    })

    it('passes when the declaration is supported by the last matching event', () => {
      const memory = createEmptyStoryMemory()
      const plan = createEmptyChapterPlan(1)
      const actualEvents = [
        itemLocationEvent('e1', 'loc-drawer-deep'),
        itemLocationEvent('e2', 'loc-drawer-right'),
      ]
      const result = validateChapterEvents(memory, 1, plan, actualEvents, {
        finalStateDeclarations: [
          { entityId: 'i-box', attribute: 'location', value: 'loc-drawer-right' },
        ],
      })
      expect(result.finalStateMismatches).toEqual([])
    })

    it('routes declarations with no supporting event to the uncorroborated (warning) channel', () => {
      const memory = createEmptyStoryMemory()
      const plan = createEmptyChapterPlan(1)
      const result = validateChapterEvents(memory, 1, plan, [], {
        finalStateDeclarations: [
          { entityId: 'i-box', attribute: 'location', value: 'loc-drawer-right' },
        ],
      })
      expect(result.finalStateMismatches).toEqual([])
      expect(result.finalStateUncorroborated).toEqual([
        {
          entityId: 'i-box',
          attribute: 'location',
          declaredValue: 'loc-drawer-right',
          actualValue: null,
        },
      ])
    })

    it('reports a mismatch when the last event value differs from the declaration', () => {
      const memory = createEmptyStoryMemory()
      const plan = createEmptyChapterPlan(1)
      const actualEvents = [itemLocationEvent('e1', 'loc-drawer-deep')]
      const result = validateChapterEvents(memory, 1, plan, actualEvents, {
        finalStateDeclarations: [
          { entityId: 'i-box', attribute: 'location', value: 'loc-drawer-right' },
        ],
      })
      expect(result.finalStateMismatches).toEqual([
        {
          entityId: 'i-box',
          attribute: 'location',
          declaredValue: 'loc-drawer-right',
          actualValue: 'loc-drawer-deep',
        },
      ])
    })

    it('uses the last of multiple events for the same entity and attribute', () => {
      const memory = createEmptyStoryMemory()
      const plan = createEmptyChapterPlan(1)
      const actualEvents = [
        itemLocationEvent('e1', 'loc-drawer-right'),
        itemLocationEvent('e2', 'loc-drawer-deep'),
      ]
      const result = validateChapterEvents(memory, 1, plan, actualEvents, {
        finalStateDeclarations: [
          { entityId: 'i-box', attribute: 'location', value: 'loc-drawer-right' },
        ],
      })
      expect(result.finalStateMismatches).toHaveLength(1)
      expect(result.finalStateMismatches[0]?.actualValue).toBe('loc-drawer-deep')
    })

    it('prefers locationId over holderId for item-location declarations', () => {
      const memory = createEmptyStoryMemory()
      const plan = createEmptyChapterPlan(1)
      const actualEvents = [
        {
          id: 'e1',
          type: 'item-location' as const,
          itemId: 'i-box',
          holderId: 'c-linxuan',
          locationId: 'loc-temple',
          chapterIndex: 1,
          source: 'chapter' as const,
        },
      ]
      const result = validateChapterEvents(memory, 1, plan, actualEvents, {
        finalStateDeclarations: [{ entityId: 'i-box', attribute: 'location', value: 'loc-temple' }],
      })
      expect(result.finalStateMismatches).toEqual([])
    })

    it('reports a mismatch when the declaration matches only holderId and not locationId', () => {
      const memory = createEmptyStoryMemory()
      const plan = createEmptyChapterPlan(1)
      const actualEvents = [
        {
          id: 'e1',
          type: 'item-location' as const,
          itemId: 'i-box',
          holderId: 'c-linxuan',
          locationId: 'loc-temple',
          chapterIndex: 1,
          source: 'chapter' as const,
        },
      ]
      const result = validateChapterEvents(memory, 1, plan, actualEvents, {
        finalStateDeclarations: [{ entityId: 'i-box', attribute: 'location', value: 'c-linxuan' }],
      })
      expect(result.finalStateMismatches).toEqual([
        {
          entityId: 'i-box',
          attribute: 'location',
          declaredValue: 'c-linxuan',
          actualValue: 'loc-temple',
        },
      ])
    })

    it('validates status declarations against the last status event value', () => {
      const memory = createEmptyStoryMemory()
      const plan = createEmptyChapterPlan(1)
      const actualEvents = [
        {
          id: 'e1',
          type: 'character-status' as const,
          characterId: 'c-linxuan',
          attribute: 'condition',
          value: 'injured',
          chapterIndex: 1,
          source: 'chapter' as const,
        },
        {
          id: 'e2',
          type: 'character-status' as const,
          characterId: 'c-linxuan',
          attribute: 'condition',
          value: 'active',
          chapterIndex: 1,
          source: 'chapter' as const,
        },
      ]
      const result = validateChapterEvents(memory, 1, plan, actualEvents, {
        finalStateDeclarations: [{ entityId: 'c-linxuan', attribute: 'status', value: 'active' }],
      })
      expect(result.finalStateMismatches).toEqual([])
    })

    it('validates boolean item-state declarations using the stringified event value', () => {
      const memory = createEmptyStoryMemory()
      const plan = createEmptyChapterPlan(1)
      const actualEvents = [
        {
          id: 'e1',
          type: 'item-state' as const,
          itemId: 'i-box',
          attribute: 'papernote-examined',
          value: 'true',
          chapterIndex: 1,
          source: 'chapter' as const,
        },
      ]
      const result = validateChapterEvents(memory, 1, plan, actualEvents, {
        finalStateDeclarations: [{ entityId: 'i-box', attribute: 'status', value: 'true' }],
      })
      expect(result.finalStateMismatches).toEqual([])
    })

    it('returns no mismatches when declarations are absent', () => {
      const memory = createEmptyStoryMemory()
      const plan = createEmptyChapterPlan(1)
      const result = validateChapterEvents(memory, 1, plan, [])
      expect(result.finalStateMismatches).toEqual([])
    })
  })
})
