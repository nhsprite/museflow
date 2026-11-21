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
import type { ProseHygieneContext } from '../graph/services/prose-hygiene/index.js'

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

/**
 * 大纲节拍认领被语义校验驳回后的反馈，随下一轮大纲生成注入 prompt。
 * 要求大纲 agent 二选一：在 description 中实质呈现该节拍，或移除认领。
 * 幕边界高压（未消费 mandatory beats 多于幕内剩余章节）下大纲零认领时，
 * 改用 requiredClaims 传达强制认领要求：本轮必须至少认领其中一个节拍。
 */
export interface BeatClaimPlanningRejection {
  rejectedClaims: Array<{ beatId: BeatId; beat: string; reason: string }>
  /** 高压零认领打回时的强制认领要求；rejectedClaims 为空而本字段存在时生效。 */
  requiredClaims?: {
    pendingMandatoryBeats: Array<{ beatId: BeatId; beat: string }>
    chaptersRemainingInAct: number
    /**
     * 强制认领的触发源：幕边界 beat 算术压力，或连续零认领章升级（C.2.3）。
     * 缺省视为 act_boundary（兼容旧 checkpoint 中持久化的驳回反馈）。
     */
    pressureSource?: 'act_boundary' | 'zero_claim_streak'
  }
  currentOutline?: {
    title: string
    description: string
  }
}

/**
 * 跨章零增量闸升级后的大纲重生成反馈（C.2.2），随下一轮大纲生成注入 prompt。
 * 携带最近若干章（零增量连击窗口内，含本章）的已接受结构化事件计数。
 */
export interface ZeroProgressRejection {
  /** 语义停滞与结构零增量分开反馈，不把事件数量当作叙事价值。 */
  narrativeProgress?: import('../types/narrative-audit.js').NarrativeChapterAssessment[]
  /** 结构零增量重试时附带本章语义结论，区分缺记录与缺推进。 */
  currentNarrativeAssessment?: import('../types/narrative-audit.js').NarrativeChapterAssessment
  /** 含本章在内的连续零增量章数。 */
  consecutiveZeroIncrementChapters: number
  recentChapterEventCounts: Array<{ chapterIndex: number; acceptedEventCount: number }>
  currentOutline?: {
    title: string
    description: string
  }
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
  beatClaimRejection?: BeatClaimPlanningRejection
  /** 跨章零增量闸触发的大纲重生成反馈（C.2.2），仅大纲生成 agent 消费。 */
  zeroProgressRejection?: ZeroProgressRejection
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
  /** 正文体例硬门禁的已知标识符集合；仅章节起草 agent 的 parse 阶段消费。 */
  proseHygiene?: ProseHygieneContext
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
    /**
     * 幕边界高压标记（未消费 mandatory beats 多于幕内剩余章节）：
     * 由 outline-expander 依据结构化进度数据计算，prompt 据此关闭"本章可不推进"的逃逸口。
     */
    mandatoryBeatClaimRequired?: boolean
    /**
     * 连续零认领升级标记（C.2.3）：此前连续多章大纲零认领 mandatory beat 时，
     * 与 mandatoryBeatClaimRequired 搭配使用，prompt 据此说明强制认领的触发原因。
     */
    zeroClaimEscalation?: boolean
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
