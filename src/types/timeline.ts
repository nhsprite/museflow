export interface StateSnapshot {
  id: string
  storyId: string
  chapterNumber: number | null  // null for story-level snapshots
  snapshotType: 'chapter_complete' | 'story_init' | 'checkpoint'

  // Story state at this point
  currentChapterIndex: number
  chapterTitle: string | null
  chapterSummary: string | null
  wordCount: number | null

  // AI-generated state summary (characters, locations, key items, plots, mood)
  stateSummary: string | null

  // Quality metrics at this point
  issuesResolved: number
  issuesPending: number

  // Metadata
  createdAt: number
  stateJson: string | null  // Full serialized state for recovery (optional, can be large)
}
