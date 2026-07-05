import type {
  StoryMemory,
  StoryEvent,
  CharacterMemory,
  ItemMemory,
  LocationMemory,
  FactionMemory,
} from '../types/story-memory.js'

export function createEmptyStoryMemory(): StoryMemory {
  return {
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
}

export function projectEntities(events: StoryEvent[]): StoryMemory['entities'] {
  const characters: Record<string, CharacterMemory> = {}
  const items: Record<string, ItemMemory> = {}
  const locations: Record<string, LocationMemory> = {}
  const factions: Record<string, FactionMemory> = {}

  for (const event of events) {
    switch (event.type) {
      case 'character-location':
        ensureCharacter(characters, event.characterId)
        characters[event.characterId]!.locationId = event.locationId
        break
      case 'character-status':
        ensureCharacter(characters, event.characterId)
        characters[event.characterId]!.status[event.attribute] = event.value
        break
      case 'item-location':
        ensureItem(items, event.itemId)
        items[event.itemId]!.holderId = event.holderId
        items[event.itemId]!.locationId = event.locationId
        break
      case 'item-state':
        ensureItem(items, event.itemId)
        items[event.itemId]!.state[event.attribute] = event.value
        break
    }
  }

  return { characters, items, locations, factions, plots: {} }
}

export function projectMemory(memory: StoryMemory): StoryMemory {
  return {
    ...memory,
    entities: projectEntities(memory.events),
  }
}

export function applyEvents(
  memory: StoryMemory,
  events: StoryEvent[],
  options: { override?: boolean } = {}
): StoryMemory {
  const nextEvents = [...memory.events, ...events]
  const nextMemory: StoryMemory = {
    ...memory,
    events: nextEvents,
  }
  return projectMemory(nextMemory)
}

function ensureCharacter(characters: Record<string, CharacterMemory>, id: string) {
  if (!characters[id]) {
    characters[id] = {
      id,
      name: id,
      locationId: null,
      status: {},
      introducedIn: 0,
    }
  }
}

function ensureItem(items: Record<string, ItemMemory>, id: string) {
  if (!items[id]) {
    items[id] = {
      id,
      name: id,
      holderId: null,
      locationId: null,
      state: {},
      introducedIn: 0,
    }
  }
}
