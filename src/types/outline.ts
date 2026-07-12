import type { EntityId, ForeshadowId, BeatId, TaskId } from './story-memory.js'

export interface ActArc {
  index: number
  startChapter: number // 1-based，目标起始章节
  endChapter: number // 1-based，目标结束章节（软约束）
  autoBoundaryAdjustment?: {
    originalEndChapter: number
    totalExtendedChapters: number
  }
  title: string
  theme: string // 幕主题
  function: string // 叙事功能
  mandatoryBeats: string[] // 该幕必须完成的事件类型/状态转移，不绑定章节
}

export interface KeyBeat {
  id: BeatId
  beat: string // 事件类型/主题
  deadlineAct: number // 必须在该幕结束前完成
  required: boolean
  involvedCharacterIds?: EntityId[]
  involvedItemIds?: EntityId[]
  foreshadowId?: ForeshadowId
}

export interface StoryArc {
  totalChapters: number // 目标总章节数（软约束）
  autoBoundaryAdjustment?: {
    originalTotalChapters: number
    totalExtendedChapters: number
  }
  acts: ActArc[]
  keyBeats: KeyBeat[] // 全局关键情节点池
}

export interface VerifiedBeatEvidence {
  beat: string
  chapterIndex: number
  quote: string
  confidence: 'high' | 'medium' | 'low'
}

export interface ChapterOutline {
  number: number
  title: string
  description: string
  introducedCharacters?: string[]
  claimedBeats?: string[] // ChapterOutlineAgent 声称本章要推进的 mandatory beats
  verifiedBeats?: string[] // SummaryAgent 从正文中验证确实发生的 mandatory beats
  claimedMandatoryBeatIds?: BeatId[] // 本章推进的 mandatory beat 稳定 ID（A{act}-M{index}）
  verifiedMandatoryBeatIds?: BeatId[] // 正文验证到的 mandatory beat 稳定 ID
  verifiedBeatEvidence?: VerifiedBeatEvidence[] // verifiedBeats 的正文证据

  // 新增结构化声明
  touchedCharacterIds?: EntityId[]
  touchedItemIds?: EntityId[]
  touchedLocationIds?: EntityId[]
  claimedBeatIds?: BeatId[] // 全局 keyBeat ID，不用于 mandatory beat 覆盖判断
  fulfilledForeshadowIds?: ForeshadowId[]
  deferredForeshadowIds?: ForeshadowId[] // 调度候选中本章裁决为顺延的伏笔 ID
  introducedForeshadowIds?: ForeshadowId[]
  resolvedTaskIds?: TaskId[]
  createdTaskIds?: TaskId[]
}
