export type EntityId = string
export type ForeshadowId = string
export type BeatId = string
export type TaskId = string
export type EventId = string
export type ForeshadowKind =
  | 'character_arc'
  | 'environmental_detail'
  | 'dialogue_hint'
  | 'object_foreshadow'
  | 'inner_conflict'
  | 'plot'
  | 'other'

export type ForeshadowResolutionPolicy = 'must_resolve' | 'should_resolve' | 'may_remain_open'

export interface StoryEventEvidence {
  /** 1-based prose paragraph index in CHAPTER_CONTENT, excluding markdown headings. */
  paragraphIndex: number
}

export type FinalStateAttribute = 'location' | 'status'

/**
 * Structured chapter-end final-state declaration emitted by the draft agent in
 * the STORY_FINAL_STATE block. For `location` attributes `value` may be an
 * entity id or `null` (off-screen / no fixed location); for `status` it must
 * be an enum value; prose is rejected at parse time.
 */
export interface ChapterFinalStateDeclaration {
  entityId: EntityId
  attribute: FinalStateAttribute
  value: string | null
}

export interface StoryMemory {
  version: '3'
  lastChapterIndex: number
  entities: {
    characters: Record<EntityId, CharacterMemory>
    items: Record<EntityId, ItemMemory>
    locations: Record<EntityId, LocationMemory>
    factions: Record<EntityId, FactionMemory>
    plots: Record<EntityId, PlotMemory>
  }
  events: StoryEvent[]
  foreshadows: Record<ForeshadowId, ForeshadowMemory>
  beats: Record<BeatId, BeatMemory>
  tasks: Record<TaskId, TaskMemory>
}

interface BaseEvent {
  id: EventId
  chapterIndex: number
  source: 'outline' | 'chapter'
  evidence?: StoryEventEvidence
}

export type StoryEvent =
  | CharacterLocationEvent
  | CharacterStatusEvent
  | ItemLocationEvent
  | ItemStateEvent
  | PlotAdvanceEvent
  | ForeshadowIntroduceEvent
  | ForeshadowFulfillEvent
  | ForeshadowDeadlineExtendEvent
  | ForeshadowPolicySetEvent
  | ForeshadowMergeEvent
  | ForeshadowWaiveEvent
  | TaskCreateEvent
  | TaskResolveEvent

export interface CharacterLocationEvent extends BaseEvent {
  type: 'character-location'
  characterId: EntityId
  locationId: EntityId | null
}

export interface CharacterStatusEvent extends BaseEvent {
  type: 'character-status'
  characterId: EntityId
  attribute: string
  value: unknown
}

export interface ItemLocationEvent extends BaseEvent {
  type: 'item-location'
  itemId: EntityId
  holderId: EntityId | null
  locationId: EntityId | null
}

export interface ItemStateEvent extends BaseEvent {
  type: 'item-state'
  itemId: EntityId
  attribute: string
  value: unknown
}

export interface PlotAdvanceEvent extends BaseEvent {
  type: 'plot-advance'
  plotId: EntityId
  beatId: BeatId
}

export interface ForeshadowIntroduceEvent extends BaseEvent {
  type: 'foreshadow-introduce'
  foreshadowId: ForeshadowId
  expectedFulfillChapter: number | null
  /** Required for newly generated events; omitted only by legacy persisted events. */
  resolutionPolicy?: ForeshadowResolutionPolicy
  text?: string
  resolutionQuestion?: string
  fulfillmentCriteria?: string
  kind?: ForeshadowKind
  required?: boolean
  beatId?: BeatId | null
}

export interface ForeshadowFulfillEvent extends BaseEvent {
  type: 'foreshadow-fulfill'
  foreshadowId: ForeshadowId
}

export interface ForeshadowDeadlineExtendEvent extends BaseEvent {
  type: 'foreshadow-deadline-extend'
  foreshadowId: ForeshadowId
  newExpectedFulfillChapter: number
}

export interface ForeshadowPolicySetEvent extends BaseEvent {
  type: 'foreshadow-policy-set'
  foreshadowId: ForeshadowId
  resolutionPolicy: ForeshadowResolutionPolicy
  expectedFulfillChapter: number | null
}

export interface ForeshadowMergeEvent extends Omit<BaseEvent, 'source'> {
  type: 'foreshadow-merge'
  source: 'outline'
  canonicalForeshadowId: ForeshadowId
  duplicateForeshadowId: ForeshadowId
  reason: string
}

/**
 * Author decision (CLI) to leave a foreshadow intentionally unresolved, e.g. a
 * thread meant to stay "永远无法送达". Waived foreshadows stop blocking act/story
 * boundaries and leave the scheduling pool; they are never produced by agents.
 */
export interface ForeshadowWaiveEvent extends BaseEvent {
  type: 'foreshadow-waive'
  foreshadowId: ForeshadowId
  reason?: string
}

export interface TaskCreateEvent extends BaseEvent {
  type: 'task-create'
  taskId: TaskId
  description: string
}

export interface TaskResolveEvent extends BaseEvent {
  type: 'task-resolve'
  taskId: TaskId
}

export interface CharacterMemory {
  id: EntityId
  name: string
  locationId: EntityId | null
  status: Record<string, unknown>
  introducedIn: number
}

export interface ItemMemory {
  id: EntityId
  name: string
  holderId: EntityId | null
  locationId: EntityId | null
  state: Record<string, unknown>
  introducedIn: number
}

export interface LocationMemory {
  id: EntityId
  name: string
  introducedIn: number
}

export interface FactionMemory {
  id: EntityId
  name: string
  introducedIn: number
}

export interface PlotMemory {
  id: EntityId
  name: string
  introducedIn: number
}

export interface ForeshadowMemory {
  id: ForeshadowId
  text: string
  kind: ForeshadowKind | null
  introducedIn: number
  expectedFulfillChapter: number | null
  fulfilledIn: number | null
  resolutionPolicy: ForeshadowResolutionPolicy
  resolutionQuestion?: string
  fulfillmentCriteria?: string
  /** Compatibility projection only. Runtime decisions use resolutionPolicy. */
  required: boolean
  beatId: BeatId | null
  deadlineExtensions?: number
  /** 作者决定不再回收（foreshadow-waive 事件）的章节索引；存在时退出调度与边界阻断。 */
  waivedIn?: number
  mergedInto?: ForeshadowId
}

export interface BeatMemory {
  id: BeatId
  description: string
  actIndex: number
  deadlineAct: number
  required: boolean
  claimedIn: number | null
  provenByEventIds: EventId[]
}

export interface TaskMemory {
  id: TaskId
  description: string
  createdIn: number
  resolvedIn: number | null
}
