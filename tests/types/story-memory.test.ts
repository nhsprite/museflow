import { describe, it, expect } from 'vitest'
import type { StoryMemory, StoryEvent } from '../../src/types/story-memory.js'

describe('StoryMemory types', () => {
  it('can construct a minimal StoryMemory', () => {
    const memory: StoryMemory = {
      version: '1',
      lastChapterIndex: 0,
      entities: {
        characters: {},
        items: {},
        locations: {},
        factions: {},
      },
      events: [],
      foreshadows: {},
      beats: {},
      tasks: {},
    }
    expect(memory.version).toBe('1')
  })

  it('event type discriminates correctly', () => {
    const event: StoryEvent = {
      id: 'evt-1',
      type: 'character-location',
      characterId: 'c-1',
      locationId: 'l-1',
      chapterIndex: 1,
      source: 'chapter',
    }
    expect(event.type).toBe('character-location')
  })
})
