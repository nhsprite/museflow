export interface SupersededFact {
  subject: string
  oldFact: string
  reason: string
  chapterIndex: number
}

export interface StoryState {
  characterLocations: Record<string, string>
  characterStatus: Record<string, string>
  keyItemsLocation: Record<string, string>
  activePlots: string[]
  revealedSecrets: string[]
  currentScene: string
  storyTime: string
  supersededFacts?: SupersededFact[]
}
