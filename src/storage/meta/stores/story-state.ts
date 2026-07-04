import type { StoryState } from '../../../types/story-state.js'

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
