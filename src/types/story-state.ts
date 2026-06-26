export interface SupersededFact {
  subject: string
  oldFact: string
  reason: string
  chapterIndex: number
}

export interface CanonicalFact {
  id: string
  subject: string
  attribute: string
  value: string
  establishedIn: number
  supersedes?: Array<{
    chapter: number
    oldValue: string
  }> | undefined
}

export interface PendingTask {
  id: string
  assignee: string
  description: string
  createdChapter: number
  dueChapter?: number | undefined
  dueTime?: string | undefined
  status: 'pending' | 'done' | 'postponed' | 'superseded' | 'expired'
}

export interface StoryState {
  characterLocations: Record<string, string>
  characterStatus: Record<string, string>
  keyItemsLocation: Record<string, string>
  keyItemsState: Record<string, string>
  activePlots: string[]
  revealedSecrets: string[]
  pendingTasks: PendingTask[]
  currentScene: string
  storyTime: string
  supersededFacts?: SupersededFact[]
  canonicalFacts?: CanonicalFact[]
}

export interface SanitizationReport {
  state: StoryState
  removedCharacters: string[]
  itemLocationConflicts: Array<{ item: string; locations: string[] }>
  removedFacts: string[]
}
