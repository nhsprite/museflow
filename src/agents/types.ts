import type { Issue } from '../types/agent.js'
import type { ForeshadowItem } from '../types/foreshadow.js'
import type { Character } from '../types/character.js'
import type { CanonicalFact } from '../types/story-state.js'
import type { StoryArc } from '../types/outline.js'
import type { WorldDirection, WritingConstraints } from '../types/story.js'
import type {
  StoryEvent,
  BeatId,
  ForeshadowId,
  ForeshadowKind,
  ForeshadowResolutionPolicy,
  StoryEventAuthorityRegistry,
  TaskId,
} from '../types/story-memory.js'

export interface ForeshadowPlanningObligation {
  id: ForeshadowId
  text: string
  resolutionQuestion?: string
  fulfillmentCriteria?: string
  kind: ForeshadowKind | null
  introducedChapter: number
  resolutionPolicy: ForeshadowResolutionPolicy
  deadlineChapter: number | null
  schedulingMode: 'mandatory' | 'opportunity' | 'ambient'
  mustFulfillThisChapter: boolean
}

export interface ForeshadowPlanningRejection {
  missingDeclarationIds: ForeshadowId[]
  missingEventIds: ForeshadowId[]
  incorrectlyDeferredIds: ForeshadowId[]
  requiredFulfillmentIds?: ForeshadowId[]
  preservedFulfillmentIds?: ForeshadowId[]
  regressedFulfillmentIds?: ForeshadowId[]
  conflictingDecisionIds?: ForeshadowId[]
  forbiddenFulfillmentIds?: ForeshadowId[]
  semanticRejections?: ForeshadowSemanticPlanningRejection[]
  currentOutline?: {
    title: string
    description: string
  }
}

export interface ForeshadowSemanticPlanningRejection {
  foreshadowId: ForeshadowId
  verdict: 'not_fulfilled' | 'uncertain'
  reason: string
}

export interface ParagraphFix {
  index: number
  content: string
  issues: Issue[]
}

export interface SentenceFix {
  paragraphIndex: number
  sentenceIndex: number
  original: string
  issue: Issue
}

export interface ChapterPlan {
  chapterIndex: number
  sections: Array<{
    title: string
    summary: string
    wordCount: number
    events: string[]
    characters: string[]
    timeMark?: string
  }>
  timeline: Array<{
    event: string
    time: string
    notes: string
  }>
  outlineCheck: Array<{
    requirement: string
    fulfilled: boolean
    section: string
  }>
  taskResolutions?: Array<{
    taskId: string
    assignee: string
    description: string
    resolution: 'executed' | 'postponed' | 'superseded' | 'background'
    reason: string
    section?: string
  }>
  chapterTimeAnchor?: string

  // 新增结构化声明
  expectedEvents: StoryEvent[]
  /** Derived internal signal; never accepted as a planner/model declaration. */
  foreshadowFulfillmentConflictIds?: ForeshadowId[]
  claimedMandatoryBeatIds?: BeatId[]
  claimedBeatIds: BeatId[]
  fulfilledForeshadowIds: ForeshadowId[]
  introducedForeshadowIds: ForeshadowId[]
  resolvedTaskIds: TaskId[]
  createdTaskIds: TaskId[]
}

export interface AgentOutput {
  success: boolean
  content?: string
  data?: unknown
  error?: string
}

/**
 * Base input shared across all agents.
 *
 * Every agent receives at least the story identity fields. All other fields
 * are optional in the base because individual agents only read a subset.
 */
export interface AgentInput {
  idea: string
  genre: string
  totalChapters: number
  title?: string
  worldDirection?: WorldDirection
  writingConstraints?: WritingConstraints
  world?: string
  characters?: string
  outline?: string
  previousChapters?: string
  chapterContent?: string
  chapterIndex?: number
  foreshadowStack?: ForeshadowItem[]
  storyState?: string
  chapterTimeAnchor?: string
  issues?: Issue[]
  verifiedConstraints?: string[]
  foreshadowObligations?: ForeshadowPlanningObligation[]
  foreshadowPlanningRejection?: ForeshadowPlanningRejection
  charactersList?: Character[]
  outlineCharacters?: Character[]
  establishedCharacters?: Character[]
  stateConflicts?: string
  canonicalFacts?: CanonicalFact[]
  chapterContract?: string
  storyArc?: StoryArc
  actProgress?: Record<number, { consumed: string[]; pending: string[] }>
  claimedBeats?: string[]
  claimedMandatoryBeatIds?: string[]
  chapterSummaries?: string[]
  chapterTitle?: string
  chapterSummary?: string
  timelineSnapshot?: string | null
  keyEventsTimeline?: string | null
  supersededFacts?: string
  nextChapterBoundary?: string
  paragraphFix?: {
    paragraphs: ParagraphFix[]
    context: string
  }
  sentenceFix?: {
    sentences: SentenceFix[]
    context: string
  }
  chapterPlan?: ChapterPlan
  storyEventAuthority?: StoryEventAuthorityRegistry
}

export type WorldbuilderAgentInput = AgentInput

export type CharacterAgentInput = AgentInput

export type StoryArcAgentInput = AgentInput

export type ChapterOutlineAgentInput = AgentInput &
  Required<Pick<AgentInput, 'chapterIndex' | 'storyArc' | 'actProgress'>> & {
    title?: string
    world?: string
    characters?: string
    previousChapters?: string
    storyState?: string
    canonicalFacts?: CanonicalFact[]
    verifiedConstraints?: string[]
    /** 上一章结束时的状态快照，用于让大纲生成时即感知当前角色/物品位置和时间锚点 */
    currentStateSnapshot?: string
  }

export type ChapterAgentInput = AgentInput &
  Required<Pick<AgentInput, 'chapterIndex'>> & {
    outline?: string
    previousChapters?: string
    world?: string
    characters?: string
    foreshadowStack?: ForeshadowItem[]
    charactersList?: Character[]
    outlineCharacters?: Character[]
    establishedCharacters?: Character[]
    storyState?: string
    canonicalFacts?: CanonicalFact[]
    chapterContract?: string
    chapterPlan?: ChapterPlan
    chapterTimeAnchor?: string
    stateConflicts?: string
    nextChapterBoundary?: string
    chapterContent?: string
    issues?: Issue[]
  }

export type ChapterPlannerAgentInput = AgentInput &
  Required<
    Pick<AgentInput, 'chapterIndex' | 'outline' | 'previousChapters' | 'world' | 'characters'>
  > & {
    charactersList?: Character[]
    outlineCharacters?: Character[]
    establishedCharacters?: Character[]
    storyState?: string
    stateConflicts?: string
    chapterContract?: string
    issues?: Issue[]
    verifiedConstraints?: string[]
  }

export type ForeshadowingAgentInput = AgentInput &
  Required<Pick<AgentInput, 'chapterContent' | 'foreshadowStack'>> & {
    world?: string
    characters?: string
  }

export type ConsistencyAgentInput = AgentInput &
  Required<
    Pick<
      AgentInput,
      'chapterIndex' | 'chapterContent' | 'world' | 'characters' | 'outline' | 'storyState'
    >
  > & {
    chapterTimeAnchor?: string
    supersededFacts?: string
    charactersList?: Character[]
    outlineCharacters?: Character[]
    establishedCharacters?: Character[]
    canonicalFacts?: CanonicalFact[]
    chapterContract?: string
    foreshadowStack?: ForeshadowItem[]
    chapterPlan?: ChapterPlan
    chapterSummaries?: string[]
  }

export type SummaryAgentInput = Omit<AgentInput, 'foreshadowStack'> &
  Required<Pick<AgentInput, 'chapterContent' | 'chapterIndex' | 'charactersList'>> & {
    chapterTitle?: string
    outlineCharacters?: Character[]
    establishedCharacters?: Character[]
    claimedBeats?: string[]
    plannedForeshadowFulfillments?: Array<Pick<ForeshadowItem, 'id' | 'text'>>
  }

export type FixAgentInput = AgentInput &
  Required<
    Pick<
      AgentInput,
      'chapterIndex' | 'chapterContent' | 'issues' | 'previousChapters' | 'timelineSnapshot'
    >
  > & {
    storyState?: string
    charactersList?: Character[]
    outlineCharacters?: Character[]
    establishedCharacters?: Character[]
    nextChapterBoundary?: string
    sentenceFix?: AgentInput['sentenceFix']
    paragraphFix?: AgentInput['paragraphFix']
    characters?: string
    outline?: string
  }
