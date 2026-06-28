export type IssueSeverity = 'error' | 'warning' | 'info'

export type IssueType =
  | 'hallucination'
  | 'consistency'
  | 'quality'
  | 'word_count'
  | 'outline_violation'
  | 'outline_deviation'
  | 'draft_failure'
  | 'outline_density'
  | 'outline_foreshadow'
  | 'state_corruption'

export interface Issue {
  id: string
  type: IssueType
  severity: IssueSeverity
  description: string
  location?: string
  suggestion?: string
}

