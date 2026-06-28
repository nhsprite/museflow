import { Annotation } from '@langchain/langgraph'
import type { Story } from '../types/story.js'
import type { Character } from '../types/character.js'
import type { Issue } from '../types/agent.js'
import type { ChapterMeta } from '../types/chapter.js'
import type { ChapterPlan } from '../agents/chapter-planner.js'
import type { StoryState } from '../types/story-state.js'
import type { ChapterReport } from '../types/chapter-report.js'
import type { WorldContent } from '../types/world.js'
import type { ChapterOutline } from '../types/outline.js'
import type { ForeshadowItem } from '../types/foreshadow.js'
import type { StateSnapshot } from '../types/timeline.js'

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
  timeline: Annotation<StateSnapshot[] | undefined>,
  chapterSummaries: Annotation<string[]>,
  pendingIssues: Annotation<Issue[]>,
  rewriteApproved: Annotation<boolean>,
  rewriteRequested: Annotation<boolean>,
  isWriting: Annotation<boolean>,
  writeOneChapterOnly: Annotation<boolean>,
  lastPrintedChapter: Annotation<number>,
  lastTimelineSnapshot: Annotation<string | null>,
  chapterPlan: Annotation<ChapterPlan | null>,
  storyState: Annotation<StoryState>,
  chapterTimeAnchor: Annotation<string | undefined>,
  autoFixAttempts: Annotation<number>,
  verifiedConstraints: Annotation<string[]>,

  chapterReport: Annotation<ChapterReport | null>,

  // chapter-writing loop state (managed by LangGraph)
  rewriteAttempts: Annotation<number>,
  errorRewriteAttempts: Annotation<number>,
  previousIssues: Annotation<Issue[]>,
  previousRawErrorCount: Annotation<number>,
  forceStructuralRewrite: Annotation<boolean>,
  routingDecision: Annotation<string | undefined>,
})

export type ReducedGraphState = typeof GraphState.State
