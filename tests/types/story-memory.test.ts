import { describe, it, expect } from 'vitest'
import type {
  StoryMemory,
  StoryEvent,
  CharacterMemory,
  ItemMemory,
  LocationMemory,
  FactionMemory,
  PlotMemory,
  ForeshadowMemory,
  BeatMemory,
  TaskMemory,
} from '../../src/types/story-memory.js'

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
        plots: {},
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

  it('can construct a CharacterMemory', () => {
    const character: CharacterMemory = {
      id: 'c-1',
      name: 'Alice',
      locationId: 'l-1',
      status: { mood: 'determined' },
      introducedIn: 1,
    }
    expect(character.name).toBe('Alice')
  })

  it('can construct an ItemMemory', () => {
    const item: ItemMemory = {
      id: 'i-1',
      name: 'Silver Key',
      holderId: 'c-1',
      locationId: null,
      state: { condition: 'pristine' },
      introducedIn: 2,
    }
    expect(item.holderId).toBe('c-1')
  })

  it('can construct a LocationMemory', () => {
    const location: LocationMemory = {
      id: 'l-1',
      name: 'Old Library',
      introducedIn: 1,
    }
    expect(location.name).toBe('Old Library')
  })

  it('can construct a FactionMemory', () => {
    const faction: FactionMemory = {
      id: 'f-1',
      name: 'The Watchers',
      introducedIn: 3,
    }
    expect(faction.name).toBe('The Watchers')
  })

  it('can construct a PlotMemory', () => {
    const plot: PlotMemory = {
      id: 'p-1',
      name: 'The Hidden Heir',
      introducedIn: 1,
    }
    expect(plot.name).toBe('The Hidden Heir')
  })

  it('can construct a ForeshadowMemory', () => {
    const foreshadow: ForeshadowMemory = {
      id: 'fs-1',
      text: 'A crow watches from the tower.',
      introducedIn: 1,
      expectedFulfillChapter: 5,
      fulfilledIn: null,
      required: true,
      beatId: 'b-1',
    }
    expect(foreshadow.required).toBe(true)
  })

  it('can construct a BeatMemory', () => {
    const beat: BeatMemory = {
      id: 'b-1',
      description: 'The protagonist discovers the map.',
      actIndex: 1,
      deadlineAct: 2,
      required: true,
      claimedIn: 4,
      provenByEventIds: ['evt-1', 'evt-2'],
    }
    expect(beat.provenByEventIds).toHaveLength(2)
  })

  it('can construct a TaskMemory', () => {
    const task: TaskMemory = {
      id: 't-1',
      description: 'Warn the council before nightfall.',
      createdIn: 2,
      resolvedIn: null,
    }
    expect(task.resolvedIn).toBeNull()
  })

  it('can construct a character-location event', () => {
    const event: StoryEvent = {
      id: 'evt-character-location',
      type: 'character-location',
      characterId: 'c-1',
      locationId: 'l-1',
      chapterIndex: 2,
      source: 'chapter',
    }
    expect(event.type).toBe('character-location')
  })

  it('can construct a character-status event', () => {
    const event: StoryEvent = {
      id: 'evt-character-status',
      type: 'character-status',
      characterId: 'c-1',
      attribute: 'health',
      value: 'wounded',
      chapterIndex: 3,
      source: 'outline',
    }
    expect(event.attribute).toBe('health')
  })

  it('can construct an item-location event', () => {
    const event: StoryEvent = {
      id: 'evt-item-location',
      type: 'item-location',
      itemId: 'i-1',
      holderId: 'c-1',
      locationId: 'l-1',
      chapterIndex: 2,
      source: 'chapter',
    }
    expect(event.holderId).toBe('c-1')
  })

  it('can construct an item-state event', () => {
    const event: StoryEvent = {
      id: 'evt-item-state',
      type: 'item-state',
      itemId: 'i-1',
      attribute: 'charge',
      value: 42,
      chapterIndex: 4,
      source: 'chapter',
    }
    expect(event.value).toBe(42)
  })

  it('can construct a plot-advance event', () => {
    const event: StoryEvent = {
      id: 'evt-plot-advance',
      type: 'plot-advance',
      plotId: 'p-1',
      beatId: 'b-1',
      chapterIndex: 5,
      source: 'outline',
    }
    expect(event.plotId).toBe('p-1')
  })

  it('can construct a foreshadow-introduce event', () => {
    const event: StoryEvent = {
      id: 'evt-foreshadow-introduce',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-1',
      expectedFulfillChapter: 6,
      chapterIndex: 1,
      source: 'chapter',
    }
    expect(event.expectedFulfillChapter).toBe(6)
  })

  it('can construct a foreshadow-fulfill event', () => {
    const event: StoryEvent = {
      id: 'evt-foreshadow-fulfill',
      type: 'foreshadow-fulfill',
      foreshadowId: 'fs-1',
      chapterIndex: 6,
      source: 'chapter',
    }
    expect(event.foreshadowId).toBe('fs-1')
  })

  it('can construct a task-create event', () => {
    const event: StoryEvent = {
      id: 'evt-task-create',
      type: 'task-create',
      taskId: 't-1',
      description: 'Find the hidden archive.',
      chapterIndex: 2,
      source: 'outline',
    }
    expect(event.description).toBe('Find the hidden archive.')
  })

  it('can construct a task-resolve event', () => {
    const event: StoryEvent = {
      id: 'evt-task-resolve',
      type: 'task-resolve',
      taskId: 't-1',
      chapterIndex: 7,
      source: 'chapter',
    }
    expect(event.taskId).toBe('t-1')
  })
})
