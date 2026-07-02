import type { Issue } from './agent.js'

export type BlockingReason =
  | 'max_rewrite_attempts'
  | 'state_corruption'
  | 'rewrite_loop_stalled'
  | 'blocking_outline_conflict'

export interface BlockingConflict {
  subject: string
  attribute: string
  oldValue: string
  newValue: string
  source: 'outline' | 'canonical' | 'author'
}

export interface BlockingSuggestedAction {
  type: 'choose_outline' | 'choose_canonical' | 'author_override' | 'manual_rewrite'
  description: string
}

export interface BlockingReport {
  id: string
  storyId: string
  chapterIndex: number
  createdAt: number
  reason: BlockingReason
  summary: string
  issues: Issue[]
  conflicts: BlockingConflict[]
  suggestedActions: BlockingSuggestedAction[]
}
