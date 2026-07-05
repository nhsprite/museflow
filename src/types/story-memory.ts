export type EntityId = string
export type ForeshadowId = string
export type BeatId = string
export type TaskId = string
export type EventId = string

export interface StoryMemory {
  version: '1'
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
}

export type StoryEvent =
  | CharacterLocationEvent
  | CharacterStatusEvent
  | ItemLocationEvent
  | ItemStateEvent
  | PlotAdvanceEvent
  | ForeshadowIntroduceEvent
  | ForeshadowFulfillEvent
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
}

export interface ForeshadowFulfillEvent extends BaseEvent {
  type: 'foreshadow-fulfill'
  foreshadowId: ForeshadowId
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
  introducedIn: number
  expectedFulfillChapter: number | null
  fulfilledIn: number | null
  required: boolean
  beatId: BeatId | null
}

export interface BeatMemory {
  id: BeatId
  description: string
  actIndex: number
  deadlineAct: number
  required: boolean
  claimedIn: number | null
  provenByEventIds: string[]
}

export interface TaskMemory {
  id: TaskId
  description: string
  createdIn: number
  resolvedIn: number | null
}
