import { Annotation } from '@langchain/langgraph'
import type { Story } from '../types/story.js'
import type { Character } from '../types/character.js'
import type { Issue } from '../types/agent.js'
import type { ChapterMeta } from '../types/chapter.js'
import type { ChapterPlan } from '../agents/types.js'
import type { StoryState, CanonicalFact, SupersededFact } from '../types/story-state.js'
import type { ChapterReport } from '../types/chapter-report.js'
import type { BlockingReport } from '../types/blocking-report.js'
import type { WorldContent } from '../types/world.js'
import type { ChapterOutline, StoryArc } from '../types/outline.js'
import type { ForeshadowItem } from '../types/foreshadow.js'
import type { StateSnapshot } from '../types/timeline.js'
import type { ChapterSession } from '../core/chapter-generation/routing/types.js'
import type { VerifiedConstraint } from '../types/verified-constraint.js'
import type {
  StoryMemory,
  StoryEvent,
  ChapterFinalStateDeclaration,
} from '../types/story-memory.js'
import type { StructuredValidationResult } from '../story-memory/validator.js'

export const GraphState = Annotation.Root({
  story: Annotation<Story>,
  idea: Annotation<string>,
  genre: Annotation<string>,
  totalChapters: Annotation<number>,
  world: Annotation<WorldContent | null>,
  characters: Annotation<Character[]>,
  storyArc: Annotation<StoryArc | null>,
  outline: Annotation<ChapterOutline[]>,
  actProgress: Annotation<Record<number, { consumed: string[]; pending: string[] }>>,
  chapters: Annotation<(ChapterMeta | null)[]>,
  currentChapterIndex: Annotation<number>,
  foreshadowStack: Annotation<ForeshadowItem[]>,
  timeline: Annotation<StateSnapshot[] | undefined>,
  // @deprecated 不再写入/读取：摘要列表由 selectChapterSummaries 从 chapters 现算。
  // 保留该通道仅为兼容旧 checkpoint 反序列化（channel_values 中的历史键有归属）。
  chapterSummaries: Annotation<string[] | undefined>,
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
  verifiedConstraints: Annotation<VerifiedConstraint[]>,

  chapterReport: Annotation<ChapterReport | null>,

  // structured blocking report for manual resolution when rewrite loop stalls
  blockingReport: Annotation<BlockingReport | null>,

  // chapter-writing loop control state (separated from business state)
  session: Annotation<ChapterSession>,

  // author resolutions for blocking outline-vs-canonical conflicts in the current chapter
  authorDecisions: Annotation<Record<string, 'outline' | 'canonical'>>,

  // structured story memory for the refactor (source of truth for entities, events, beats, tasks, foreshadows)
  storyMemory: Annotation<StoryMemory | null>,

  // events extracted from the current draft chapter before validation
  draftChapterEvents: Annotation<StoryEvent[] | undefined>,

  // chapter-end final-state declarations self-reported by the draft (STORY_FINAL_STATE block)
  chapterFinalStateDeclarations: Annotation<ChapterFinalStateDeclaration[] | undefined>,

  // canonical/superseded facts produced by the reconciler during the current
  // chapter's draft; finalize_chapter merges them into storyState and clears them
  canonicalFactsDelta: Annotation<CanonicalFact[] | undefined>,
  supersededFactsDelta: Annotation<SupersededFact[] | undefined>,

  // structured validation result for the current chapter (populated by the story memory validator)
  structuredValidationResult: Annotation<StructuredValidationResult | undefined>,
})

export type ReducedGraphState = typeof GraphState.State
