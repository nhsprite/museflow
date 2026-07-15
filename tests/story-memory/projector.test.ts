import { describe, it, expect } from 'vitest'
import type { StoryMemory } from '../../src/types/story-memory.js'
import type { StoryArc } from '../../src/types/outline.js'
import {
  createEmptyStoryMemory,
  projectEntities,
  projectMemory,
  projectStoryStateFromMemory,
  applyEvents,
  computeLastChapterIndex,
  ensureBeatsHaveActIndex,
} from '../../src/story-memory/projector.js'
import { ForeshadowMergeValidationError } from '../../src/story-memory/foreshadow-alias.js'

describe('computeLastChapterIndex', () => {
  it('returns fallback when no events', () => {
    expect(computeLastChapterIndex([], 5)).toBe(5)
  })

  it('returns max chapter index when events exist', () => {
    const events = [
      {
        id: 'e1',
        type: 'character-location' as const,
        characterId: 'c-1',
        locationId: 'l-1',
        chapterIndex: 2,
        source: 'chapter' as const,
      },
      {
        id: 'e2',
        type: 'character-location' as const,
        characterId: 'c-1',
        locationId: 'l-2',
        chapterIndex: 7,
        source: 'chapter' as const,
      },
    ]
    expect(computeLastChapterIndex(events, 3)).toBe(7)
  })

  it('returns fallback when fallback is greater than event indices', () => {
    const events = [
      {
        id: 'e1',
        type: 'character-location' as const,
        characterId: 'c-1',
        locationId: 'l-1',
        chapterIndex: 2,
        source: 'chapter' as const,
      },
    ]
    expect(computeLastChapterIndex(events, 5)).toBe(5)
  })
})

describe('projectEntities', () => {
  it('tracks character location changes', () => {
    const events = [
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
        chapterIndex: 2,
        source: 'chapter' as const,
      },
    ]
    const entities = projectEntities(events)
    expect(entities.characters['c-1']?.locationId).toBe('l-2')
  })

  it('tracks item holder changes', () => {
    const events = [
      {
        id: 'e1',
        type: 'item-location' as const,
        itemId: 'i-1',
        holderId: 'c-1',
        locationId: null,
        chapterIndex: 1,
        source: 'chapter' as const,
      },
      {
        id: 'e2',
        type: 'item-location' as const,
        itemId: 'i-1',
        holderId: 'c-2',
        locationId: null,
        chapterIndex: 2,
        source: 'chapter' as const,
      },
    ]
    const entities = projectEntities(events)
    expect(entities.items['i-1']?.holderId).toBe('c-2')
  })

  it('tracks character status changes', () => {
    const events = [
      {
        id: 'e1',
        type: 'character-status' as const,
        characterId: 'c-1',
        attribute: 'mood',
        value: 'angry',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
      {
        id: 'e2',
        type: 'character-status' as const,
        characterId: 'c-1',
        attribute: 'mood',
        value: 'calm',
        chapterIndex: 2,
        source: 'chapter' as const,
      },
    ]
    const entities = projectEntities(events)
    expect(entities.characters['c-1']?.status['mood']).toBe('calm')
  })

  it('tracks item state changes', () => {
    const events = [
      {
        id: 'e1',
        type: 'item-state' as const,
        itemId: 'i-1',
        attribute: 'condition',
        value: 'broken',
        chapterIndex: 1,
        source: 'chapter' as const,
      },
      {
        id: 'e2',
        type: 'item-state' as const,
        itemId: 'i-1',
        attribute: 'condition',
        value: 'repaired',
        chapterIndex: 2,
        source: 'chapter' as const,
      },
    ]
    const entities = projectEntities(events)
    expect(entities.items['i-1']?.state['condition']).toBe('repaired')
  })
})

describe('ensureBeatsHaveActIndex', () => {
  it('pre-populates stable mandatory beat ids separately from global key beats', () => {
    const storyArc: StoryArc = {
      totalChapters: 3,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 3,
          title: 'Act',
          theme: '',
          function: '',
          mandatoryBeats: ['身份暴露', '阵营洗牌'],
        },
      ],
      keyBeats: [{ id: 'A1-B1', beat: '全局关键节点', deadlineAct: 1, required: true }],
    }

    const memory = ensureBeatsHaveActIndex(createEmptyStoryMemory(), storyArc)

    expect(memory.beats['A1-M1']).toEqual(
      expect.objectContaining({
        id: 'A1-M1',
        description: '身份暴露',
        actIndex: 1,
        deadlineAct: 1,
        required: true,
      })
    )
    expect(memory.beats['A1-M2']).toEqual(
      expect.objectContaining({
        id: 'A1-M2',
        description: '阵营洗牌',
        actIndex: 1,
        deadlineAct: 1,
        required: true,
      })
    )
    expect(memory.beats['A1-B1']).toEqual(
      expect.objectContaining({
        id: 'A1-B1',
        description: '全局关键节点',
      })
    )
  })
})

describe('applyEvents', () => {
  it('appends events and updates projection', () => {
    const memory = createEmptyStoryMemory()
    const next = applyEvents(memory, [
      {
        id: 'e1',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'l-1',
        chapterIndex: 1,
        source: 'chapter',
      },
    ])
    expect(next.events).toHaveLength(1)
    expect(next.entities.characters['c-1']?.locationId).toBe('l-1')
  })
})

describe('createEmptyStoryMemory', () => {
  it('returns a valid empty StoryMemory', () => {
    const memory = createEmptyStoryMemory()
    expect(memory.version).toBe('3')
    expect(memory.events).toHaveLength(0)
    expect(Object.keys(memory.entities.characters)).toHaveLength(0)
  })
})

describe('projectMemory', () => {
  it('recomputes entities from events', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      events: [
        {
          id: 'e1',
          type: 'character-location',
          characterId: 'c-1',
          locationId: 'l-1',
          chapterIndex: 1,
          source: 'chapter',
        },
      ],
    }
    const projected = projectMemory(memory)
    expect(projected.entities.characters['c-1']?.locationId).toBe('l-1')
  })
})

describe('projectStoryStateFromMemory', () => {
  it('projects structured memory fields while preserving legacy-only storyState fields', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'character-location',
        characterId: 'char-1',
        locationId: 'room-2',
        chapterIndex: 0,
        source: 'chapter',
      },
      {
        id: 'e2',
        type: 'character-status',
        characterId: 'char-1',
        attribute: 'status',
        value: 'injured',
        chapterIndex: 0,
        source: 'chapter',
      },
      {
        id: 'e3',
        type: 'item-location',
        itemId: 'item-1',
        holderId: 'char-1',
        locationId: null,
        chapterIndex: 0,
        source: 'chapter',
      },
      {
        id: 'e4',
        type: 'item-state',
        itemId: 'item-1',
        attribute: 'state',
        value: 'sealed',
        chapterIndex: 0,
        source: 'chapter',
      },
      {
        id: 'e5',
        type: 'task-create',
        taskId: 'task-1',
        description: 'Find the key',
        chapterIndex: 1,
        source: 'chapter',
      },
      {
        id: 'e6',
        type: 'task-resolve',
        taskId: 'task-1',
        chapterIndex: 2,
        source: 'chapter',
      },
    ])

    const state = projectStoryStateFromMemory(memory, {
      characterLocations: { 'char-1': 'room-1', legacy: 'old-room' },
      characterStatus: {},
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: ['legacy plot'],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: 'legacy scene',
      storyTime: 'legacy time',
      canonicalFacts: [
        {
          id: 'fact-1',
          subject: 'legacy',
          attribute: 'status',
          value: 'kept',
          establishedIn: 0,
          confidence: 'high',
          source: 'chapter_text',
        },
      ],
    })

    expect(state.characterLocations).toEqual({ 'char-1': 'room-2', legacy: 'old-room' })
    expect(state.characterStatus['char-1']).toBe('injured')
    expect(state.keyItemsLocation['item-1']).toBe('char-1')
    expect(state.keyItemsState['item-1']).toBe('sealed')
    expect(state.pendingTasks[0]).toMatchObject({
      id: 'task-1',
      description: 'Find the key',
      createdChapter: 2,
      status: 'done',
    })
    expect(state.activePlots).toEqual(['legacy plot'])
    expect(state.canonicalFacts?.[0]?.id).toBe('fact-1')
  })
})

describe('applyEvents immutability', () => {
  it('does not mutate the input memory', () => {
    const memory = createEmptyStoryMemory()
    const next = applyEvents(memory, [
      {
        id: 'e1',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'l-1',
        chapterIndex: 1,
        source: 'chapter',
      },
    ])
    expect(memory.events).toHaveLength(0)
    expect(next).not.toBe(memory)
    expect(next.events).not.toBe(memory.events)
  })
})

describe('projectMemory foreshadows', () => {
  it('does not materialize a foreshadow whose deadline is not after its introduction chapter', () => {
    const next = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e-invalid',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-invalid',
        expectedFulfillChapter: 0,
        chapterIndex: 9,
        source: 'chapter',
      },
    ])

    expect(next.events).toHaveLength(1)
    expect(next.foreshadows['f-invalid']).toBeUndefined()
  })

  it('tracks foreshadow introduction and fulfillment', () => {
    const memory = createEmptyStoryMemory()
    const next = applyEvents(memory, [
      {
        id: 'e1',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-1',
        expectedFulfillChapter: 5,
        chapterIndex: 1,
        source: 'outline',
      },
      {
        id: 'e2',
        type: 'foreshadow-fulfill',
        foreshadowId: 'f-1',
        chapterIndex: 4,
        source: 'chapter',
      },
    ])
    expect(next.foreshadows['f-1']?.fulfilledIn).toBe(4)
  })

  it('marks a foreshadow as waived by a foreshadow-waive event', () => {
    const next = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-1',
        expectedFulfillChapter: 5,
        chapterIndex: 1,
        source: 'outline',
      },
      {
        id: 'e2',
        type: 'foreshadow-waive',
        foreshadowId: 'f-1',
        reason: '主题需要保持悬置',
        chapterIndex: 6,
        source: 'outline',
      },
    ])

    expect(next.foreshadows['f-1']?.waivedIn).toBe(6)
    expect(next.foreshadows['f-1']?.fulfilledIn).toBeNull()
  })

  it('projects policy promotion and demotion atomically', () => {
    const introduced = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e-policy-introduce',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-policy',
        resolutionPolicy: 'should_resolve',
        expectedFulfillChapter: null,
        chapterIndex: 1,
        source: 'outline',
      },
    ])
    const promoted = applyEvents(introduced, [
      {
        id: 'e-policy-promote',
        type: 'foreshadow-policy-set',
        foreshadowId: 'f-policy',
        resolutionPolicy: 'must_resolve',
        expectedFulfillChapter: 20,
        chapterIndex: 5,
        source: 'outline',
      },
    ] as never)

    expect(promoted.foreshadows['f-policy']).toMatchObject({
      resolutionPolicy: 'must_resolve',
      expectedFulfillChapter: 20,
      required: true,
    })

    const demoted = applyEvents(promoted, [
      {
        id: 'e-policy-demote',
        type: 'foreshadow-policy-set',
        foreshadowId: 'f-policy',
        resolutionPolicy: 'may_remain_open',
        expectedFulfillChapter: null,
        chapterIndex: 6,
        source: 'outline',
      },
    ] as never)

    expect(demoted.foreshadows['f-policy']).toMatchObject({
      resolutionPolicy: 'may_remain_open',
      expectedFulfillChapter: null,
      required: false,
    })
  })

  it('ignores a waive event for an unknown foreshadow', () => {
    const next = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'foreshadow-waive',
        foreshadowId: 'f-missing',
        chapterIndex: 6,
        source: 'outline',
      },
    ])

    expect(next.foreshadows['f-missing']).toBeUndefined()
  })

  it('preserves foreshadow introduction metadata from structured events', () => {
    const memory = createEmptyStoryMemory()
    const next = applyEvents(memory, [
      {
        id: 'e1',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-1',
        text: '门后的争执声暗示某个尚未公开的约定',
        kind: 'dialogue_hint',
        required: false,
        beatId: 'A1-M2',
        expectedFulfillChapter: 5,
        chapterIndex: 1,
        source: 'chapter',
      },
    ])

    expect(next.foreshadows['f-1']).toMatchObject({
      id: 'f-1',
      text: '门后的争执声暗示某个尚未公开的约定',
      kind: 'dialogue_hint',
      resolutionPolicy: 'may_remain_open',
      required: false,
      beatId: 'A1-M2',
      expectedFulfillChapter: null,
      introducedIn: 1,
      fulfilledIn: null,
    })
  })

  it('handles fulfillment before introduction defensively', () => {
    const memory = createEmptyStoryMemory()
    const next = applyEvents(memory, [
      {
        id: 'e1',
        type: 'foreshadow-fulfill',
        foreshadowId: 'f-1',
        chapterIndex: 4,
        source: 'chapter',
      },
    ])
    expect(next.foreshadows['f-1']?.fulfilledIn).toBe(4)
    expect(next.foreshadows['f-1']?.introducedIn).toBe(4)
  })

  it('extends the foreshadow deadline and counts extensions', () => {
    const memory = createEmptyStoryMemory()
    const next = applyEvents(memory, [
      {
        id: 'e1',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-1',
        expectedFulfillChapter: 5,
        chapterIndex: 1,
        source: 'outline',
      },
      {
        id: 'e2',
        type: 'foreshadow-deadline-extend',
        foreshadowId: 'f-1',
        newExpectedFulfillChapter: 13,
        chapterIndex: 4,
        source: 'outline',
      },
      {
        id: 'e3',
        type: 'foreshadow-deadline-extend',
        foreshadowId: 'f-1',
        newExpectedFulfillChapter: 21,
        chapterIndex: 12,
        source: 'outline',
      },
    ])

    expect(next.foreshadows['f-1']?.expectedFulfillChapter).toBe(21)
    expect(next.foreshadows['f-1']?.deadlineExtensions).toBe(2)
  })

  it('ignores a deadline extension for an unknown foreshadow', () => {
    const memory = createEmptyStoryMemory()
    const next = applyEvents(memory, [
      {
        id: 'e1',
        type: 'foreshadow-deadline-extend',
        foreshadowId: 'f-unknown',
        newExpectedFulfillChapter: 13,
        chapterIndex: 4,
        source: 'outline',
      },
    ])

    expect(next.foreshadows['f-unknown']).toBeUndefined()
  })

  it('preserves the extension count across fulfillment and re-introduction', () => {
    const memory = createEmptyStoryMemory()
    const next = applyEvents(memory, [
      {
        id: 'e1',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-1',
        expectedFulfillChapter: 5,
        chapterIndex: 1,
        source: 'outline',
      },
      {
        id: 'e2',
        type: 'foreshadow-deadline-extend',
        foreshadowId: 'f-1',
        newExpectedFulfillChapter: 13,
        chapterIndex: 4,
        source: 'outline',
      },
      {
        id: 'e3',
        type: 'foreshadow-fulfill',
        foreshadowId: 'f-1',
        chapterIndex: 6,
        source: 'chapter',
      },
    ])

    expect(next.foreshadows['f-1']?.fulfilledIn).toBe(6)
    expect(next.foreshadows['f-1']?.deadlineExtensions).toBe(1)
  })

  it('transfers the earliest duplicate fulfillment without strengthening canonical state', () => {
    const next = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'introduce-canonical',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-canonical',
        text: 'A sealed record has an unexplained mark',
        kind: 'environmental_detail',
        resolutionPolicy: 'must_resolve',
        expectedFulfillChapter: 8,
        beatId: 'A1-M1',
        chapterIndex: 1,
        source: 'outline',
      },
      {
        id: 'extend-canonical',
        type: 'foreshadow-deadline-extend',
        foreshadowId: 'fs-canonical',
        newExpectedFulfillChapter: 10,
        chapterIndex: 2,
        source: 'outline',
      },
      {
        id: 'demote-canonical',
        type: 'foreshadow-policy-set',
        foreshadowId: 'fs-canonical',
        resolutionPolicy: 'may_remain_open',
        expectedFulfillChapter: null,
        chapterIndex: 3,
        source: 'outline',
      },
      {
        id: 'waive-canonical',
        type: 'foreshadow-waive',
        foreshadowId: 'fs-canonical',
        chapterIndex: 4,
        source: 'outline',
      },
      {
        id: 'fulfill-canonical',
        type: 'foreshadow-fulfill',
        foreshadowId: 'fs-canonical',
        chapterIndex: 6,
        source: 'chapter',
      },
      {
        id: 'introduce-duplicate',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-duplicate',
        text: 'The same unexplained mark remains on the sealed record',
        kind: 'object_foreshadow',
        resolutionPolicy: 'must_resolve',
        expectedFulfillChapter: 20,
        beatId: 'A2-M1',
        chapterIndex: 2,
        source: 'outline',
      },
      {
        id: 'extend-duplicate-one',
        type: 'foreshadow-deadline-extend',
        foreshadowId: 'fs-duplicate',
        newExpectedFulfillChapter: 22,
        chapterIndex: 3,
        source: 'outline',
      },
      {
        id: 'extend-duplicate-two',
        type: 'foreshadow-deadline-extend',
        foreshadowId: 'fs-duplicate',
        newExpectedFulfillChapter: 24,
        chapterIndex: 4,
        source: 'outline',
      },
      {
        id: 'fulfill-duplicate',
        type: 'foreshadow-fulfill',
        foreshadowId: 'fs-duplicate',
        chapterIndex: 5,
        source: 'chapter',
      },
      {
        id: 'waive-duplicate',
        type: 'foreshadow-waive',
        foreshadowId: 'fs-duplicate',
        chapterIndex: 7,
        source: 'outline',
      },
      {
        id: 'merge-duplicate',
        type: 'foreshadow-merge',
        canonicalForeshadowId: 'fs-canonical',
        duplicateForeshadowId: 'fs-duplicate',
        reason: 'The records describe one obligation',
        chapterIndex: 8,
        source: 'outline',
      },
    ])

    expect(next.foreshadows['fs-canonical']).toEqual({
      id: 'fs-canonical',
      text: 'A sealed record has an unexplained mark',
      kind: 'environmental_detail',
      introducedIn: 1,
      expectedFulfillChapter: null,
      fulfilledIn: 5,
      resolutionPolicy: 'may_remain_open',
      required: false,
      beatId: 'A1-M1',
      deadlineExtensions: 1,
      waivedIn: 4,
    })
    expect(next.foreshadows['fs-duplicate']).toMatchObject({
      text: 'The same unexplained mark remains on the sealed record',
      kind: 'object_foreshadow',
      expectedFulfillChapter: 24,
      fulfilledIn: 5,
      resolutionPolicy: 'must_resolve',
      required: true,
      beatId: 'A2-M1',
      deadlineExtensions: 2,
      waivedIn: 7,
      mergedInto: 'fs-canonical',
    })
  })

  it('routes a later alias-addressed fulfillment to the root canonical record', () => {
    const next = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'introduce-root',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-root',
        resolutionPolicy: 'should_resolve',
        expectedFulfillChapter: null,
        chapterIndex: 1,
        source: 'outline',
      },
      {
        id: 'introduce-alias',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-alias',
        resolutionPolicy: 'should_resolve',
        expectedFulfillChapter: null,
        chapterIndex: 2,
        source: 'outline',
      },
      {
        id: 'merge-alias',
        type: 'foreshadow-merge',
        canonicalForeshadowId: 'fs-root',
        duplicateForeshadowId: 'fs-alias',
        reason: 'The records describe one obligation',
        chapterIndex: 3,
        source: 'outline',
      },
      {
        id: 'fulfill-alias',
        type: 'foreshadow-fulfill',
        foreshadowId: 'fs-alias',
        chapterIndex: 7,
        source: 'chapter',
      },
    ])

    expect(next.foreshadows['fs-root']?.fulfilledIn).toBe(7)
    expect(next.foreshadows['fs-alias']?.fulfilledIn).toBeNull()
  })

  it('leaves the canonical contract unchanged for later alias mutations', () => {
    const next = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'introduce-root',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-root',
        resolutionPolicy: 'should_resolve',
        expectedFulfillChapter: null,
        chapterIndex: 1,
        source: 'outline',
      },
      {
        id: 'introduce-alias',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-alias',
        resolutionPolicy: 'must_resolve',
        expectedFulfillChapter: 12,
        chapterIndex: 2,
        source: 'outline',
      },
      {
        id: 'merge-alias',
        type: 'foreshadow-merge',
        canonicalForeshadowId: 'fs-root',
        duplicateForeshadowId: 'fs-alias',
        reason: 'The records describe one obligation',
        chapterIndex: 3,
        source: 'outline',
      },
      {
        id: 'extend-alias',
        type: 'foreshadow-deadline-extend',
        foreshadowId: 'fs-alias',
        newExpectedFulfillChapter: 16,
        chapterIndex: 4,
        source: 'outline',
      },
      {
        id: 'promote-alias',
        type: 'foreshadow-policy-set',
        foreshadowId: 'fs-alias',
        resolutionPolicy: 'must_resolve',
        expectedFulfillChapter: 20,
        chapterIndex: 5,
        source: 'outline',
      },
      {
        id: 'waive-alias',
        type: 'foreshadow-waive',
        foreshadowId: 'fs-alias',
        chapterIndex: 6,
        source: 'outline',
      },
    ])

    expect(next.foreshadows['fs-root']).toMatchObject({
      resolutionPolicy: 'should_resolve',
      expectedFulfillChapter: null,
      fulfilledIn: null,
    })
    expect(next.foreshadows['fs-root']).not.toHaveProperty('deadlineExtensions')
    expect(next.foreshadows['fs-root']).not.toHaveProperty('waivedIn')
  })

  it.each([
    ['unknown canonical', 'fs-missing', 'fs-late'],
    ['unknown duplicate', 'fs-early', 'fs-missing'],
    ['reversed introduction order', 'fs-late', 'fs-early'],
  ])('rejects an invalid merge with %s', (_name, canonicalId, duplicateId) => {
    const introduced = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'introduce-early',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-early',
        resolutionPolicy: 'should_resolve',
        expectedFulfillChapter: null,
        chapterIndex: 1,
        source: 'outline',
      },
      {
        id: 'introduce-late',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-late',
        resolutionPolicy: 'should_resolve',
        expectedFulfillChapter: null,
        chapterIndex: 2,
        source: 'outline',
      },
    ])

    expect(() =>
      applyEvents(introduced, [
        {
          id: 'invalid-merge',
          type: 'foreshadow-merge',
          canonicalForeshadowId: canonicalId,
          duplicateForeshadowId: duplicateId,
          reason: 'The records describe one obligation',
          chapterIndex: 3,
          source: 'outline',
        },
      ])
    ).toThrow(ForeshadowMergeValidationError)
  })

  it('rejects reversed order when an earlier raw canonical introduction was invalid', () => {
    expect(() =>
      applyEvents(createEmptyStoryMemory(), [
        {
          id: 'introduce-canonical-invalid',
          type: 'foreshadow-introduce',
          foreshadowId: 'fs-canonical',
          resolutionPolicy: 'must_resolve',
          expectedFulfillChapter: 1,
          chapterIndex: 0,
          source: 'outline',
        },
        {
          id: 'introduce-duplicate-valid',
          type: 'foreshadow-introduce',
          foreshadowId: 'fs-duplicate',
          resolutionPolicy: 'should_resolve',
          expectedFulfillChapter: null,
          chapterIndex: 1,
          source: 'outline',
        },
        {
          id: 'introduce-canonical-valid',
          type: 'foreshadow-introduce',
          foreshadowId: 'fs-canonical',
          resolutionPolicy: 'should_resolve',
          expectedFulfillChapter: null,
          chapterIndex: 2,
          source: 'outline',
        },
        {
          id: 'merge-reversed-valid-order',
          type: 'foreshadow-merge',
          canonicalForeshadowId: 'fs-canonical',
          duplicateForeshadowId: 'fs-duplicate',
          reason: 'The records describe one obligation',
          chapterIndex: 3,
          source: 'outline',
        },
      ])
    ).toThrow(ForeshadowMergeValidationError)
  })

  it('accepts canonical order based on a later valid introduction after an invalid one', () => {
    const next = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'introduce-canonical-invalid',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-canonical',
        resolutionPolicy: 'must_resolve',
        expectedFulfillChapter: 1,
        chapterIndex: 0,
        source: 'outline',
      },
      {
        id: 'introduce-canonical-valid',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-canonical',
        resolutionPolicy: 'should_resolve',
        expectedFulfillChapter: null,
        chapterIndex: 2,
        source: 'outline',
      },
      {
        id: 'introduce-duplicate-valid',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-duplicate',
        resolutionPolicy: 'should_resolve',
        expectedFulfillChapter: null,
        chapterIndex: 3,
        source: 'outline',
      },
      {
        id: 'merge-valid-order',
        type: 'foreshadow-merge',
        canonicalForeshadowId: 'fs-canonical',
        duplicateForeshadowId: 'fs-duplicate',
        reason: 'The records describe one obligation',
        chapterIndex: 4,
        source: 'outline',
      },
    ])

    expect(next.foreshadows['fs-duplicate']?.mergedInto).toBe('fs-canonical')
  })

  it('rejects a duplicate that was already merged', () => {
    const introduced = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'introduce-early',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-early',
        resolutionPolicy: 'should_resolve',
        expectedFulfillChapter: null,
        chapterIndex: 1,
        source: 'outline',
      },
      {
        id: 'introduce-late',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-late',
        resolutionPolicy: 'should_resolve',
        expectedFulfillChapter: null,
        chapterIndex: 2,
        source: 'outline',
      },
    ])

    expect(() =>
      applyEvents(introduced, [
        {
          id: 'merge-once',
          type: 'foreshadow-merge',
          canonicalForeshadowId: 'fs-early',
          duplicateForeshadowId: 'fs-late',
          reason: 'The records describe one obligation',
          chapterIndex: 3,
          source: 'outline',
        },
        {
          id: 'merge-twice',
          type: 'foreshadow-merge',
          canonicalForeshadowId: 'fs-early',
          duplicateForeshadowId: 'fs-late',
          reason: 'The records describe one obligation',
          chapterIndex: 4,
          source: 'outline',
        },
      ])
    ).toThrow(ForeshadowMergeValidationError)
  })

  it('rejects a merge between ids that already share one root', () => {
    const introduced = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'introduce-early',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-early',
        resolutionPolicy: 'should_resolve',
        expectedFulfillChapter: null,
        chapterIndex: 1,
        source: 'outline',
      },
      {
        id: 'introduce-late',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-late',
        resolutionPolicy: 'should_resolve',
        expectedFulfillChapter: null,
        chapterIndex: 2,
        source: 'outline',
      },
    ])

    expect(() =>
      applyEvents(introduced, [
        {
          id: 'merge-forward',
          type: 'foreshadow-merge',
          canonicalForeshadowId: 'fs-early',
          duplicateForeshadowId: 'fs-late',
          reason: 'The records describe one obligation',
          chapterIndex: 3,
          source: 'outline',
        },
        {
          id: 'merge-back',
          type: 'foreshadow-merge',
          canonicalForeshadowId: 'fs-late',
          duplicateForeshadowId: 'fs-early',
          reason: 'The records describe one obligation',
          chapterIndex: 4,
          source: 'outline',
        },
      ])
    ).toThrow(ForeshadowMergeValidationError)
  })
})

describe('projectMemory beats', () => {
  it('tracks plot-advance events', () => {
    const memory = createEmptyStoryMemory()
    const next = applyEvents(memory, [
      {
        id: 'e1',
        type: 'plot-advance',
        plotId: 'p-1',
        beatId: 'a1-b1',
        chapterIndex: 2,
        source: 'chapter',
      },
    ])
    expect(next.beats['a1-b1']?.provenByEventIds).toContain('e1')
  })
})

describe('projectMemory tasks', () => {
  it('tracks task creation and resolution', () => {
    const memory = createEmptyStoryMemory()
    const next = applyEvents(memory, [
      {
        id: 'e1',
        type: 'task-create',
        taskId: 't-1',
        description: 'find the key',
        chapterIndex: 1,
        source: 'chapter',
      },
      {
        id: 'e2',
        type: 'task-resolve',
        taskId: 't-1',
        chapterIndex: 3,
        source: 'chapter',
      },
    ])
    expect(next.tasks['t-1']?.resolvedIn).toBe(3)
  })

  it('handles resolution before creation defensively', () => {
    const memory = createEmptyStoryMemory()
    const next = applyEvents(memory, [
      {
        id: 'e1',
        type: 'task-resolve',
        taskId: 't-1',
        chapterIndex: 3,
        source: 'chapter',
      },
    ])
    expect(next.tasks['t-1']?.resolvedIn).toBe(3)
  })
})

describe('ensureBeatsHaveActIndex', () => {
  it('returns the same memory when storyArc is null', () => {
    const memory = createEmptyStoryMemory()
    expect(ensureBeatsHaveActIndex(memory, null)).toBe(memory)
  })

  it('pre-populates beats from storyArc keyBeats with correct actIndex', () => {
    const memory = createEmptyStoryMemory()
    const storyArc: StoryArc = {
      totalChapters: 3,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 3,
          title: '启程',
          theme: '出发',
          function: '建立动机',
          mandatoryBeats: ['主角离开家乡'],
        },
      ],
      keyBeats: [{ id: 'beat-1', beat: '主角离开家乡', deadlineAct: 1, required: true }],
    }

    const next = ensureBeatsHaveActIndex(memory, storyArc)

    expect(next.beats['beat-1']).toEqual({
      id: 'beat-1',
      description: '主角离开家乡',
      actIndex: 1,
      deadlineAct: 1,
      required: true,
      claimedIn: null,
      provenByEventIds: [],
    })
  })

  it('preserves existing proven event ids and claimed chapter', () => {
    const memory = createEmptyStoryMemory()
    memory.beats['beat-1'] = {
      id: 'beat-1',
      description: 'legacy',
      actIndex: 0,
      deadlineAct: 0,
      required: true,
      claimedIn: 2,
      provenByEventIds: ['evt-1'],
    }

    const storyArc: StoryArc = {
      totalChapters: 5,
      acts: [
        {
          index: 2,
          startChapter: 3,
          endChapter: 5,
          title: '成长',
          theme: '修炼',
          function: '提升实力',
          mandatoryBeats: ['主角突破'],
        },
      ],
      keyBeats: [{ id: 'beat-1', beat: '主角突破', deadlineAct: 2, required: true }],
    }

    const next = ensureBeatsHaveActIndex(memory, storyArc)

    expect(next.beats['beat-1']?.actIndex).toBe(2)
    expect(next.beats['beat-1']?.description).toBe('主角突破')
    expect(next.beats['beat-1']?.claimedIn).toBe(2)
    expect(next.beats['beat-1']?.provenByEventIds).toContain('evt-1')
  })
})

describe('projectStoryStateFromMemory — attribute projection and null updates', () => {
  function makeMemory(events: StoryMemory['events']): StoryMemory {
    return applyEvents(createEmptyStoryMemory(), events)
  }

  it('keeps the conventional status key when present', () => {
    const memory = makeMemory([
      {
        id: 'e1',
        type: 'character-status',
        characterId: 'c-hero',
        attribute: 'status',
        value: '健康',
        chapterIndex: 0,
        source: 'chapter',
      },
      {
        id: 'e2',
        type: 'character-status',
        characterId: 'c-hero',
        attribute: '伤势',
        value: '轻伤',
        chapterIndex: 1,
        source: 'chapter',
      },
    ])
    const state = projectStoryStateFromMemory(memory)
    expect(state.characterStatus['c-hero']).toBe('健康')
  })

  it('falls back to the latest attribute when the conventional key is absent', () => {
    const memory = makeMemory([
      {
        id: 'e1',
        type: 'character-status',
        characterId: 'c-hero',
        attribute: '伤势',
        value: '轻伤',
        chapterIndex: 0,
        source: 'chapter',
      },
    ])
    const state = projectStoryStateFromMemory(memory)
    expect(state.characterStatus['c-hero']).toBe('轻伤')
  })

  it('projects non-standard item state attributes', () => {
    const memory = makeMemory([
      {
        id: 'e1',
        type: 'item-state',
        itemId: 'i-sword',
        attribute: '损耗',
        value: '崩刃',
        chapterIndex: 0,
        source: 'chapter',
      },
    ])
    const state = projectStoryStateFromMemory(memory)
    expect(state.keyItemsState['i-sword']).toBe('崩刃')
  })

  it('deletes a stale projected location when an explicit null update exists', () => {
    const memory = makeMemory([
      {
        id: 'e1',
        type: 'character-location',
        characterId: 'c-hero',
        locationId: 'l-village',
        chapterIndex: 0,
        source: 'chapter',
      },
      {
        id: 'e2',
        type: 'character-location',
        characterId: 'c-hero',
        locationId: null,
        chapterIndex: 1,
        source: 'chapter',
      },
    ])
    const state = projectStoryStateFromMemory(memory)
    expect(state.characterLocations['c-hero']).toBeUndefined()
  })

  it('preserves base locations for characters without location events', () => {
    const memory = makeMemory([
      {
        id: 'e1',
        type: 'character-status',
        characterId: 'c-hero',
        attribute: 'status',
        value: '健康',
        chapterIndex: 0,
        source: 'chapter',
      },
    ])
    const base = projectStoryStateFromMemory(createEmptyStoryMemory())
    base.characterLocations['c-hero'] = 'l-author-override'
    const state = projectStoryStateFromMemory(memory, base)
    expect(state.characterLocations['c-hero']).toBe('l-author-override')
  })
})
