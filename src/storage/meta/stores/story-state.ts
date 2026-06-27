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
    canonicalFacts: [],
  }
}

export function isEmptyStoryState(state: StoryState | null): boolean {
  if (!state) return true
  return (
    Object.keys(state.characterLocations || {}).length === 0 &&
    Object.keys(state.characterStatus || {}).length === 0 &&
    Object.keys(state.keyItemsLocation || {}).length === 0 &&
    Object.keys(state.keyItemsState || {}).length === 0 &&
    (state.activePlots || []).length === 0 &&
    (state.revealedSecrets || []).length === 0 &&
    (state.pendingTasks || []).length === 0 &&
    (state.supersededFacts || []).length === 0 &&
    (state.canonicalFacts || []).length === 0 &&
    !state.currentScene &&
    !state.storyTime
  )
}
