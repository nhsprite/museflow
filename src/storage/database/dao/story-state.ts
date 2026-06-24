import type { StoryState } from '../../../types/story-state.js'
import { readMetaJsonSync, writeMetaJsonSync } from '../index.js'

export function saveStoryState(storyId: string, storyState: StoryState): void {
  const meta = readMetaJsonSync(storyId)
  if (!meta) throw new Error(`Story ${storyId} not found`)

  meta.storyState = storyState
  writeMetaJsonSync(storyId, meta)
}

export function getStoryState(storyId: string): StoryState | null {
  const meta = readMetaJsonSync(storyId)
  return meta?.storyState ?? null
}

export function createEmptyStoryState(): StoryState {
  return {
    characterLocations: {},
    characterStatus: {},
    keyItemsLocation: {},
    keyItemsState: {},
    activePlots: [],
    revealedSecrets: [],
    pendingTasks: [],
    currentScene: '',
    storyTime: '',
  }
}
