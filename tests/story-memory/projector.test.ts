import { describe, it, expect } from 'vitest'
import {
  createEmptyStoryMemory,
  projectEntities,
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
