import type {
  BeatId,
  ForeshadowId,
  ForeshadowKind,
  ForeshadowResolutionPolicy,
} from './story-memory.js'

export type ForeshadowStatus = 'planted' | 'hinted' | 'shown' | 'recalled'

export interface ForeshadowItem {
  id: ForeshadowId
  text: string
  expectedFulfillChapter: number
  createdAt: number
  createdAtChapter: number
  fulfilledChapter?: number
  status: ForeshadowStatus
  isExplicit: boolean
  source?: 'content' | 'outline' | 'manual'
  /** Missing only in legacy checkpoint projections. */
  resolutionPolicy?: ForeshadowResolutionPolicy
  /** Compatibility projection only. Runtime decisions use resolutionPolicy. */
  required: boolean
  beatId?: BeatId
  kind?: ForeshadowKind
  deadlineExtensions?: number
}

export type ForeshadowAlertLevel = 'overdue' | 'urgent' | 'normal'

export interface ForeshadowAlert {
  item: ForeshadowItem
  level: ForeshadowAlertLevel
  currentChapter: number
}
