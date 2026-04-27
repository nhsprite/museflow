import { Annotation } from '@langchain/langgraph'
import type { Story } from '../types/story.js'
import type { Character } from '../types/character.js'
import type { Issue } from '../types/agent.js'
import type { ChapterMeta } from '../types/chapter.js'
import type { ChapterPlan } from '../agents/chapter-planner.js'

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

export interface ForeshadowItem {
  id: string
  text: string
  expectedFulfillChapter: number
  createdAt: number
  fulfilledChapter?: number
}

export const GraphState = Annotation.Root({
  story: Annotation<Story>,
  idea: Annotation<string>,
  genre: Annotation<string>,
  totalChapters: Annotation<number>,
  world: Annotation<WorldContent | null>,
  characters: Annotation<Character[]>,
  outline: Annotation<ChapterOutline[]>,
  chapters: Annotation<(ChapterMeta | null)[]>,
  currentChapterIndex: Annotation<number>,
  foreshadowStack: Annotation<ForeshadowItem[]>,
  chapterSummaries: Annotation<string[]>,
  pendingIssues: Annotation<Issue[]>,
  rewriteApproved: Annotation<boolean>,
  rewriteRequested: Annotation<boolean>,
  isWriting: Annotation<boolean>,
  writeOneChapterOnly: Annotation<boolean>,
  lastPrintedChapter: Annotation<number>,
  lastTimelineSnapshot: Annotation<string | null>,
  chapterPlan: Annotation<ChapterPlan | null>,
})

export type ReducedGraphState = typeof GraphState.State
