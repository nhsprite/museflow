export type IssueSeverity = 'error' | 'warning' | 'info'

export type IssueType =
  | 'consistency'
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

export interface Issue {
  id: string
  type: IssueType
  severity: IssueSeverity
  description: string
  location?: string
  suggestion?: string
  dimension?: string
}

