import { describe, it, expect } from 'vitest'
import type { StoryMemory } from '../../src/types/story-memory.js'
import {
  createEmptyStoryMemory,
  projectEntities,
  projectMemory,
  applyEvents,
  computeLastChapterIndex,
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
