import { Annotation } from '@langchain/langgraph'
import type { Story } from '../types/story.js'
import type { Character } from '../types/character.js'
import type { Issue } from '../types/agent.js'
import type { ChapterMeta } from '../types/chapter.js'

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
  /** Controls whether draft_chapter is reachable after create_outline.
   *  - start / runStory: false (planning only, skip chapter writing)
   *  - write / continue: true (resume chapter writing)
   */
  isWriting: Annotation<boolean>,
  /** When true, stop after current chapter instead of continuing to next.
   *  Used by write command to write only one chapter per run.
   */
  writeOneChapterOnly: Annotation<boolean>,
  /** Tracks the last chapter index for which completion was printed.
   *  Prevents duplicate prints during graph replay.
   */
  lastPrintedChapter: Annotation<number>,
  /** Stores the last generated timeline snapshot stateSummary string.
   *  Used to track timeline state across the graph without re-reading from disk.
   */
  lastTimelineSnapshot: Annotation<string | null>,
  /** When true, indicates draft_chapter skipped writing because chapter already exists.
   *  Used by edge condition to skip validation and go directly to finalize_chapter.
   */
  draftSkipped: Annotation<boolean>,
})

export type ReducedGraphState = typeof GraphState.State
