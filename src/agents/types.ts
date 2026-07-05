import type { Issue } from '../types/agent.js'
import type { ForeshadowItem } from '../types/foreshadow.js'
import type { Character } from '../types/character.js'
import type { CanonicalFact } from '../types/story-state.js'
import type { StoryArc } from '../types/outline.js'
import type { WorldDirection } from '../types/story.js'
import type { StoryEvent, BeatId, ForeshadowId, TaskId } from '../types/story-memory.js'

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
  charactersList?: Character[]
  outlineCharacters?: Character[]
  establishedCharacters?: Character[]
  stateConflicts?: string
  canonicalFacts?: CanonicalFact[]
  chapterContract?: string
  storyArc?: StoryArc
  actProgress?: Record<number, { consumed: string[]; pending: string[] }>
  claimedBeats?: string[]
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

export type SummaryAgentInput = AgentInput &
  Required<Pick<AgentInput, 'chapterContent' | 'chapterIndex' | 'charactersList'>> & {
    chapterTitle?: string
    outlineCharacters?: Character[]
    establishedCharacters?: Character[]
    claimedBeats?: string[]
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
