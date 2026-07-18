import type { ReducedGraphState } from '../graph/state.js'
import type {
  StoryEvent,
  StoryEventAuthorityReference,
  StoryEventAuthorityReferenceKind,
  StoryEventAuthorityRegistry,
} from '../types/story-memory.js'
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

const REFERENCE_KIND_ORDER: Record<StoryEventAuthorityReferenceKind, number> = {
  character: 0,
  item: 1,
  location: 2,
  plot: 3,
  beat: 4,
  foreshadow: 5,
  task: 6,
}

function addReference(
  references: Map<string, StoryEventAuthorityReference>,
  authority: StoryEventAuthority,
  kind: StoryEventAuthorityReferenceKind,
  id: unknown,
  label: unknown
): void {
  if (!isMachineReadableId(id) || typeof label !== 'string' || label.trim().length === 0) return

  const knownIds =
    kind === 'character'
      ? authority.characterIds
      : kind === 'item'
        ? authority.itemIds
        : kind === 'location'
          ? authority.locationIds
          : kind === 'plot'
            ? authority.plotIds
            : kind === 'beat'
              ? authority.beatIds
              : kind === 'foreshadow'
                ? authority.foreshadowIds
                : authority.taskIds
  if (!knownIds.has(id)) return

  const key = `${kind}:${id}`
  if (!references.has(key)) references.set(key, { kind, id, label })
}

function collectAuthorityReferences(
  state: ReducedGraphState,
  authority: StoryEventAuthority
): StoryEventAuthorityReference[] {
  const references = new Map<string, StoryEventAuthorityReference>()
  const memory = state.storyMemory

  for (const character of state.characters ?? []) {
    addReference(references, authority, 'character', character.id, character.name)
  }
  if (memory) {
    for (const entity of Object.values(memory.entities.characters)) {
      addReference(references, authority, 'character', entity.id, entity.name)
    }
    for (const entity of Object.values(memory.entities.items)) {
      addReference(references, authority, 'item', entity.id, entity.name)
    }
    for (const entity of Object.values(memory.entities.locations)) {
      addReference(references, authority, 'location', entity.id, entity.name)
    }
    for (const entity of Object.values(memory.entities.plots)) {
      addReference(references, authority, 'plot', entity.id, entity.name)
    }
    for (const entity of Object.values(memory.foreshadows)) {
      addReference(references, authority, 'foreshadow', entity.id, entity.text)
    }
    for (const entity of Object.values(memory.tasks)) {
      addReference(references, authority, 'task', entity.id, entity.description)
    }
  }
  for (const foreshadow of state.foreshadowStack ?? []) {
    addReference(references, authority, 'foreshadow', foreshadow.id, foreshadow.text)
  }
  for (const task of state.storyState?.pendingTasks ?? []) {
    addReference(references, authority, 'task', task.id, task.description)
  }

  const currentAct = state.storyArc?.acts.find(
    (act) =>
      state.currentChapterIndex + 1 >= act.startChapter &&
      state.currentChapterIndex + 1 <= act.endChapter
  )
  if (state.storyArc && currentAct) {
    addReference(references, authority, 'plot', `act-${currentAct.index}`, currentAct.title)
    for (const beat of getMandatoryBeatEntries(state.storyArc)) {
      if (beat.actIndex === currentAct.index) {
        addReference(references, authority, 'beat', beat.id, beat.beat)
      }
    }
    for (const beat of state.storyArc.keyBeats) {
      if (beat.deadlineAct === currentAct.index) {
        addReference(references, authority, 'beat', beat.id, beat.beat)
      }
    }
  }

  return [...references.values()].sort(
    (left, right) =>
      REFERENCE_KIND_ORDER[left.kind] - REFERENCE_KIND_ORDER[right.kind] ||
      left.id.localeCompare(right.id)
  )
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
    references: collectAuthorityReferences(state, authority),
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
