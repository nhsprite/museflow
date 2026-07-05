import { describe, it, expect } from 'vitest'
import { migrateFromStoryState } from '../../src/story-memory/migrator.js'
import type { StoryState } from '../../src/types/story-state.js'

describe('migrateFromStoryState', () => {
  it('migrates character locations', () => {
    const state: StoryState = {
      characterLocations: { 'c-1': 'l-1' },
      characterStatus: {},
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    }
    const memory = migrateFromStoryState(state, 5)
    expect(memory.entities.characters['c-1']?.locationId).toBe('l-1')
    expect(memory.lastChapterIndex).toBe(5)
  })

  it('migrates item state and location', () => {
    const state: StoryState = {
      characterLocations: {},
      characterStatus: {},
      keyItemsLocation: { 'i-1': 'l-2' },
      keyItemsState: { 'i-1': 'broken' },
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    }
    const memory = migrateFromStoryState(state, 3)
    expect(memory.entities.items['i-1']?.locationId).toBe('l-2')
    expect(memory.entities.items['i-1']?.state['state']).toBe('broken')
  })

  it('migrates pending tasks', () => {
    const state: StoryState = {
      characterLocations: {},
      characterStatus: {},
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [
        {
          id: 't-1',
          assignee: 'c-1',
          description: 'find key',
          createdChapter: 1,
          status: 'pending',
        },
      ],
      currentScene: '',
      storyTime: '',
    }
    const memory = migrateFromStoryState(state, 3)
    expect(memory.tasks['t-1']?.description).toBe('find key')
    expect(memory.tasks['t-1']?.resolvedIn).toBeNull()
  })

  it('migrates resolved tasks', () => {
    const state: StoryState = {
      characterLocations: {},
      characterStatus: {},
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [
        {
          id: 't-1',
          assignee: 'c-1',
          description: 'find key',
          createdChapter: 1,
          status: 'done',
        },
      ],
      currentScene: '',
      storyTime: '',
    }
    const memory = migrateFromStoryState(state, 3)
    expect(memory.tasks['t-1']?.resolvedIn).toBe(3)
  })

  it('migrates character status', () => {
    const state: StoryState = {
      characterLocations: {},
      characterStatus: { 'c-1': 'injured' },
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    }
    const memory = migrateFromStoryState(state, 2)
    expect(memory.entities.characters['c-1']?.status['status']).toBe('injured')
  })

  it('produces unique event ids across repeated migrations', () => {
    const state: StoryState = {
      characterLocations: { 'c-1': 'l-1' },
      characterStatus: {},
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    }
    const memory3 = migrateFromStoryState(state, 3)
    const memory5 = migrateFromStoryState(state, 5)
    const ids3 = new Set(memory3.events.map((e) => e.id))
    const ids5 = new Set(memory5.events.map((e) => e.id))
    for (const id of ids5) {
      expect(ids3.has(id)).toBe(false)
    }
  })
})
