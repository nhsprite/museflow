export interface WorldContent {
  id: string
  storyId: string
  content: string
}

export interface ContextSnapshot {
  id: string
  storyId: string
  stateJson: string
  createdAt: number
}
