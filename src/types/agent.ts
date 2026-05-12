export type IssueSeverity = 'error' | 'warning' | 'info'

export interface Issue {
  id: string
  type: 'hallucination' | 'consistency' | 'quality' | 'word_count' | 'outline_violation' | 'outline_deviation' | 'draft_failure'
  severity: IssueSeverity
  description: string
  location?: string
  suggestion?: string
}

export interface AgentResult {
  success: boolean
  content?: string
  issues?: Issue[]
  error?: string
}

export interface AgentInput {
  idea?: string
  world?: string
  characters?: string
  outline?: string
  chapterContent?: string
  genrePrompt?: string
  chapterIndex?: number
  totalChapters?: number
}
