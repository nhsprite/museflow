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
    expect(memory.version).toBe('1')
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
      required: false,
      beatId: 'A1-M2',
      expectedFulfillChapter: 5,
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
