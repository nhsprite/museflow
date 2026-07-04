export type IssueSeverity = 'error' | 'warning' | 'info'

export type IssueType =
  | 'consistency'
  | 'continuity'
  | 'word_count'
  | 'outline_violation'
  | 'outline_deviation'
  | 'draft_failure'
  | 'outline_density'
  | 'outline_foreshadow'
  | 'state_corruption'
  | 'outline_missing'
  | 'outline_gap'
  | 'outline_invalid'
  | 'outline_coverage'
  | 'outline_empty_beats'
  | 'outline_invalid_deadline'

export type IssueSource =
  | 'word_count'
  | 'foreshadowing'
  | 'consistency'
  | 'outline_compliance'
  | 'quality'
  | 'outline_density'
  | 'state_reconciliation'

export type RetryStrategy = 'draft' | 'fix' | 'manual'

export interface IssueLocationRef {
  paragraphIndex?: number
  sentenceIndex?: number
}

export interface Issue {
  id: string
  type: IssueType
  severity: IssueSeverity
  description: string
  location?: string
  locationRef?: IssueLocationRef
  suggestion?: string
  dimension?: string
  source?: IssueSource
  retryStrategy?: RetryStrategy
}
