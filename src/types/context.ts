import type { Story } from './story.js'
import type { Character } from './character.js'
import type { ChapterMeta } from './chapter.js'
import type { Issue } from './agent.js'

export interface WorldContent {
  id: string
  storyId: string
  content: string
}

export interface ChapterOutline {
  number: number
  title: string
  description: string
}

export type ForeshadowStatus = 'planted' | 'hinted' | 'shown' | 'recalled'

export interface ForeshadowItem {
  id: string
  text: string
  expectedFulfillChapter: number
  createdAt: number
  createdAtChapter: number
  fulfilledChapter?: number
  status: ForeshadowStatus
  isExplicit: boolean
}

export interface GraphState {
  // Story metadata
  story: Story
  idea: string
  genre: string
  totalChapters: number

  // Planning phase outputs
  world: WorldContent | null
  characters: Character[]
  outline: ChapterOutline[]

  // Per-chapter generation state
  chapters: (ChapterMeta | null)[]
  currentChapterIndex: number

  // Quality assurance accumulated data
  foreshadowStack: ForeshadowItem[]
  chapterSummaries: string[]

  // Rewrite flow state
  pendingIssues: Issue[]
  rewriteApproved: boolean
  rewriteRequested: boolean
}

export interface ContextSnapshot {
  id: string
  storyId: string
  stateJson: string
  createdAt: number
}
