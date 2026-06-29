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
  source?: 'outline' | 'author' | 'inferred' | undefined
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
  overrides?: StateOverride[]
}

export interface SanitizationReport {
  state: StoryState
  removedCharacters: string[]
  itemLocationConflicts: Array<{ item: string; locations: string[] }>
  removedFacts: string[]
  ambiguousItems: Array<{ location: string; items: string[] }>
}

export interface StateOverride {
  id: string
  subject: string
  attribute: string
  oldValue: string
  newValue: string
  reason: string
  source: 'outline' | 'author' | 'inferred'
  chapterIndex: number
  createdAt: number
}

export type ConflictType =
  | 'retcon'
  | 'extension'
  | 'time_jump'
  | 'alias'
  | 'contradiction'
  | 'incomplete'

export type ConflictSeverity = 'auto' | 'warning' | 'blocking'

export interface Conflict {
  id: string
  type: ConflictType
  subject: string
  attribute: string
  oldValue: string
  newValue: string
  outlineReference: string
  severity: ConflictSeverity
  description: string
}

export interface ReconciliationReport {
  state: StoryState
  conflicts: Conflict[]
  autoResolved: Conflict[]
  requiresAuthorDecision: Conflict[]
  suggestedOverrides: StateOverride[]
}
