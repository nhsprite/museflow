import { describe, it, expect } from 'vitest'
import type { StoryMemory } from '../../src/types/story-memory.js'
import {
  createEmptyStoryMemory,
  projectEntities,
  projectMemory,
  applyEvents,
} from '../../src/story-memory/projector.js'

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
