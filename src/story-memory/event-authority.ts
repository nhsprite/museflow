import type { ReducedGraphState } from '../graph/state.js'
import type { StoryEvent, StoryEventAuthorityRegistry } from '../types/story-memory.js'
import { getMandatoryBeatEntries } from '../utils/mandatory-beat-ids.js'
import { isMachineReadableId } from './identifier.js'
import { GLOBAL_KEY_BEAT_PLOT_ID } from './protocol-ids.js'

export interface StoryEventAuthority {
  characterIds: Set<string>
  itemIds: Set<string>
  locationIds: Set<string>
  plotIds: Set<string>
  beatIds: Set<string>
  foreshadowIds: Set<string>
  taskIds: Set<string>
}

export interface PlannedStoryEventAuthorityIssue {
  index: number
  eventType: StoryEvent['type']
  field: string
  id: string
}

function addId(target: Set<string>, value: unknown): void {
  if (isMachineReadableId(value)) target.add(value)
}

function collectEventReferences(authority: StoryEventAuthority, event: StoryEvent): void {
  switch (event.type) {
    case 'character-location':
      addId(authority.characterIds, event.characterId)
      addId(authority.locationIds, event.locationId)
      break
    case 'character-status':
      addId(authority.characterIds, event.characterId)
      break
    case 'item-location':
      addId(authority.itemIds, event.itemId)
      addId(authority.locationIds, event.locationId)
      break
    case 'item-state':
      addId(authority.itemIds, event.itemId)
      break
    case 'plot-advance':
      addId(authority.plotIds, event.plotId)
      addId(authority.beatIds, event.beatId)
      break
    case 'foreshadow-introduce':
      addId(authority.foreshadowIds, event.foreshadowId)
      addId(authority.beatIds, event.beatId)
      break
    case 'foreshadow-fulfill':
    case 'foreshadow-deadline-extend':
    case 'foreshadow-policy-set':
    case 'foreshadow-waive':
      addId(authority.foreshadowIds, event.foreshadowId)
      break
    case 'foreshadow-merge':
      addId(authority.foreshadowIds, event.canonicalForeshadowId)
      addId(authority.foreshadowIds, event.duplicateForeshadowId)
      break
    case 'task-create':
    case 'task-resolve':
      addId(authority.taskIds, event.taskId)
      break
  }
}

export function collectStoryEventAuthority(state: ReducedGraphState): StoryEventAuthority {
  const authority: StoryEventAuthority = {
    characterIds: new Set(),
    itemIds: new Set(),
    locationIds: new Set(),
    plotIds: new Set(),
    beatIds: new Set(),
    foreshadowIds: new Set(),
    taskIds: new Set(),
  }
  const memory = state.storyMemory

  for (const character of state.characters ?? []) addId(authority.characterIds, character.id)
  for (const id of Object.keys(state.storyState?.characterLocations ?? {})) {
    addId(authority.characterIds, id)
  }
  for (const id of Object.keys(state.storyState?.characterStatus ?? {})) {
    addId(authority.characterIds, id)
  }
  for (const id of Object.keys(state.storyState?.keyItemsLocation ?? {})) {
    addId(authority.itemIds, id)
  }
  for (const id of Object.keys(state.storyState?.keyItemsState ?? {})) {
    addId(authority.itemIds, id)
  }
  for (const id of Object.values(state.storyState?.characterLocations ?? {})) {
    addId(authority.locationIds, id)
  }
  for (const id of Object.values(state.storyState?.keyItemsLocation ?? {})) {
    addId(authority.locationIds, id)
  }
  for (const task of state.storyState?.pendingTasks ?? []) addId(authority.taskIds, task.id)
  for (const item of state.foreshadowStack ?? []) addId(authority.foreshadowIds, item.id)

  if (memory) {
    for (const [id, entity] of Object.entries(memory.entities.characters)) {
      addId(authority.characterIds, id)
      addId(authority.locationIds, entity.locationId)
    }
    for (const [id, entity] of Object.entries(memory.entities.items)) {
      addId(authority.itemIds, id)
      addId(authority.locationIds, entity.locationId)
    }
    for (const id of Object.keys(memory.entities.locations)) addId(authority.locationIds, id)
    for (const id of Object.keys(memory.entities.plots)) addId(authority.plotIds, id)
    for (const id of Object.keys(memory.beats)) addId(authority.beatIds, id)
    for (const id of Object.keys(memory.foreshadows)) addId(authority.foreshadowIds, id)
    for (const id of Object.keys(memory.tasks)) addId(authority.taskIds, id)
  }

  if (state.storyArc) {
    for (const act of state.storyArc.acts) addId(authority.plotIds, `act-${act.index}`)
    for (const beat of getMandatoryBeatEntries(state.storyArc)) addId(authority.beatIds, beat.id)
    for (const beat of state.storyArc.keyBeats) addId(authority.beatIds, beat.id)
    if (state.storyArc.keyBeats.length > 0) {
      addId(authority.plotIds, GLOBAL_KEY_BEAT_PLOT_ID)
    }
  }

  for (const event of memory?.events ?? []) collectEventReferences(authority, event)
  return authority
}

function sortedIds(ids: ReadonlySet<string>): string[] {
  return [...ids].sort()
}

export function buildStoryEventAuthorityRegistry(
  state: ReducedGraphState
): StoryEventAuthorityRegistry {
  const authority = collectStoryEventAuthority(state)
  return {
    characterIds: sortedIds(authority.characterIds),
    itemIds: sortedIds(authority.itemIds),
    locationIds: sortedIds(authority.locationIds),
    plotIds: sortedIds(authority.plotIds),
    beatIds: sortedIds(authority.beatIds),
    foreshadowIds: sortedIds(authority.foreshadowIds),
    taskIds: sortedIds(authority.taskIds),
  }
}

function requireKnown(
  issues: PlannedStoryEventAuthorityIssue[],
  knownIds: ReadonlySet<string>,
  event: StoryEvent,
  index: number,
  field: string,
  id: string | null
): void {
  if (id === null || knownIds.has(id)) return
  issues.push({ index, eventType: event.type, field, id })
}

export function validatePlannedStoryEventAuthority(
  state: ReducedGraphState,
  events: readonly StoryEvent[]
): PlannedStoryEventAuthorityIssue[] {
  const authority = collectStoryEventAuthority(state)
  const issues: PlannedStoryEventAuthorityIssue[] = []

  events.forEach((event, index) => {
    switch (event.type) {
      case 'character-location':
        requireKnown(issues, authority.characterIds, event, index, 'characterId', event.characterId)
        requireKnown(issues, authority.locationIds, event, index, 'locationId', event.locationId)
        break
      case 'character-status':
        requireKnown(issues, authority.characterIds, event, index, 'characterId', event.characterId)
        break
      case 'item-location': {
        requireKnown(issues, authority.itemIds, event, index, 'itemId', event.itemId)
        const holderIds = new Set([...authority.characterIds, ...authority.itemIds])
        const locationIds = new Set([...authority.locationIds, ...holderIds])
        requireKnown(issues, holderIds, event, index, 'holderId', event.holderId)
        requireKnown(issues, locationIds, event, index, 'locationId', event.locationId)
        break
      }
      case 'item-state':
        requireKnown(issues, authority.itemIds, event, index, 'itemId', event.itemId)
        break
      case 'plot-advance':
        requireKnown(issues, authority.plotIds, event, index, 'plotId', event.plotId)
        requireKnown(issues, authority.beatIds, event, index, 'beatId', event.beatId)
        break
      case 'foreshadow-introduce':
        requireKnown(issues, authority.beatIds, event, index, 'beatId', event.beatId ?? null)
        break
      case 'foreshadow-fulfill':
      case 'foreshadow-deadline-extend':
      case 'foreshadow-policy-set':
      case 'foreshadow-waive':
        requireKnown(
          issues,
          authority.foreshadowIds,
          event,
          index,
          'foreshadowId',
          event.foreshadowId
        )
        break
      case 'foreshadow-merge':
        requireKnown(
          issues,
          authority.foreshadowIds,
          event,
          index,
          'canonicalForeshadowId',
          event.canonicalForeshadowId
        )
        requireKnown(
          issues,
          authority.foreshadowIds,
          event,
          index,
          'duplicateForeshadowId',
          event.duplicateForeshadowId
        )
        break
      case 'task-resolve':
        requireKnown(issues, authority.taskIds, event, index, 'taskId', event.taskId)
        break
      case 'task-create':
        break
    }
  })

  return issues
}
