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

const REFERENCE_KIND_ORDER: Record<StoryEventAuthorityReferenceKind, number> = {
  character: 0,
  item: 1,
  location: 2,
  plot: 3,
  beat: 4,
  foreshadow: 5,
  task: 6,
}

const MAX_PLANNER_AUTHORITY_IDS_PER_KIND = 64
const MAX_PLANNER_AUTHORITY_REFERENCES_PER_KIND = 24
const MAX_PLANNER_AUTHORITY_LABEL_LENGTH = 80

function compareMachineStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function createEmptyAuthority(): StoryEventAuthority {
  return {
    characterIds: new Set(),
    itemIds: new Set(),
    locationIds: new Set(),
    plotIds: new Set(),
    beatIds: new Set(),
    foreshadowIds: new Set(),
    taskIds: new Set(),
  }
}

function addRelevantId(
  relevantIds: Set<string>,
  knownIds: ReadonlySet<string>,
  value: unknown
): void {
  if (isMachineReadableId(value) && knownIds.has(value)) relevantIds.add(value)
}

function collectPlannerRelevantAuthority(
  state: ReducedGraphState,
  authority: StoryEventAuthority
): StoryEventAuthority {
  const relevant = createEmptyAuthority()
  const outline = state.outline?.[state.currentChapterIndex]
  const memory = state.storyMemory

  for (const id of outline?.touchedCharacterIds ?? []) {
    addRelevantId(relevant.characterIds, authority.characterIds, id)
  }
  for (const id of Object.keys(state.storyState?.characterLocations ?? {})) {
    addRelevantId(relevant.characterIds, authority.characterIds, id)
  }
  for (const id of Object.keys(state.storyState?.characterStatus ?? {})) {
    addRelevantId(relevant.characterIds, authority.characterIds, id)
  }
  for (const character of state.characters ?? []) {
    addRelevantId(relevant.characterIds, authority.characterIds, character.id)
  }

  for (const id of outline?.touchedItemIds ?? []) {
    addRelevantId(relevant.itemIds, authority.itemIds, id)
  }
  for (const id of Object.keys(state.storyState?.keyItemsLocation ?? {})) {
    addRelevantId(relevant.itemIds, authority.itemIds, id)
  }
  for (const id of Object.keys(state.storyState?.keyItemsState ?? {})) {
    addRelevantId(relevant.itemIds, authority.itemIds, id)
  }

  for (const id of outline?.touchedLocationIds ?? []) {
    addRelevantId(relevant.locationIds, authority.locationIds, id)
  }
  for (const id of Object.values(state.storyState?.characterLocations ?? {})) {
    addRelevantId(relevant.locationIds, authority.locationIds, id)
  }
  for (const id of Object.values(state.storyState?.keyItemsLocation ?? {})) {
    addRelevantId(relevant.locationIds, authority.locationIds, id)
  }
  for (const id of relevant.characterIds) {
    addRelevantId(
      relevant.locationIds,
      authority.locationIds,
      memory?.entities.characters[id]?.locationId
    )
  }
  for (const id of relevant.itemIds) {
    addRelevantId(
      relevant.locationIds,
      authority.locationIds,
      memory?.entities.items[id]?.locationId
    )
  }

  for (const id of state.storyState?.activePlots ?? []) {
    addRelevantId(relevant.plotIds, authority.plotIds, id)
  }
  for (const id of outline?.claimedMandatoryBeatIds ?? []) {
    addRelevantId(relevant.beatIds, authority.beatIds, id)
  }
  for (const id of outline?.claimedBeatIds ?? []) {
    addRelevantId(relevant.beatIds, authority.beatIds, id)
  }

  for (const id of [
    ...(outline?.fulfilledForeshadowIds ?? []),
    ...(outline?.deferredForeshadowIds ?? []),
  ]) {
    addRelevantId(relevant.foreshadowIds, authority.foreshadowIds, id)
  }
  for (const foreshadow of state.foreshadowStack ?? []) {
    if (foreshadow.fulfilledChapter === undefined) {
      addRelevantId(relevant.foreshadowIds, authority.foreshadowIds, foreshadow.id)
    }
  }
  for (const foreshadow of Object.values(memory?.foreshadows ?? {})) {
    if (
      foreshadow.fulfilledIn === null &&
      foreshadow.waivedIn === undefined &&
      foreshadow.mergedInto === undefined
    ) {
      addRelevantId(relevant.foreshadowIds, authority.foreshadowIds, foreshadow.id)
    }
  }

  for (const id of outline?.resolvedTaskIds ?? []) {
    addRelevantId(relevant.taskIds, authority.taskIds, id)
  }
  for (const task of state.storyState?.pendingTasks ?? []) {
    if (task.status === 'pending' || task.status === 'postponed') {
      addRelevantId(relevant.taskIds, authority.taskIds, task.id)
    }
  }
  for (const task of Object.values(memory?.tasks ?? {})) {
    if (task.resolvedIn === null) addRelevantId(relevant.taskIds, authority.taskIds, task.id)
  }

  const currentAct = state.storyArc?.acts.find(
    (act) =>
      state.currentChapterIndex + 1 >= act.startChapter &&
      state.currentChapterIndex + 1 <= act.endChapter
  )
  if (state.storyArc && currentAct) {
    addRelevantId(relevant.plotIds, authority.plotIds, `act-${currentAct.index}`)
    for (const beat of getMandatoryBeatEntries(state.storyArc)) {
      if (beat.actIndex === currentAct.index) {
        addRelevantId(relevant.beatIds, authority.beatIds, beat.id)
      }
    }
    const currentKeyBeats = state.storyArc.keyBeats.filter(
      (beat) => beat.deadlineAct === currentAct.index
    )
    if (currentKeyBeats.length > 0) {
      addRelevantId(relevant.plotIds, authority.plotIds, GLOBAL_KEY_BEAT_PLOT_ID)
    }
    for (const beat of currentKeyBeats) {
      addRelevantId(relevant.beatIds, authority.beatIds, beat.id)
      for (const id of beat.involvedCharacterIds ?? []) {
        addRelevantId(relevant.characterIds, authority.characterIds, id)
      }
      for (const id of beat.involvedItemIds ?? []) {
        addRelevantId(relevant.itemIds, authority.itemIds, id)
      }
      addRelevantId(relevant.foreshadowIds, authority.foreshadowIds, beat.foreshadowId)
    }
  }

  return relevant
}

interface SelectedAuthorityIds {
  selected: string[]
  rendered: string[]
  omitted: number
}

function selectAuthorityIds(
  authorityIds: ReadonlySet<string>,
  relevantIds: ReadonlySet<string>
): SelectedAuthorityIds {
  const selected = [...relevantIds]
    .filter((id) => authorityIds.has(id))
    .slice(0, MAX_PLANNER_AUTHORITY_IDS_PER_KIND)
  return {
    selected,
    rendered: [...selected].sort(compareMachineStrings),
    omitted: Math.max(0, authorityIds.size - selected.length),
  }
}

function truncateReferenceLabel(value: string): string {
  const trimmed = value.trim()
  return trimmed.length <= MAX_PLANNER_AUTHORITY_LABEL_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MAX_PLANNER_AUTHORITY_LABEL_LENGTH - 1)}…`
}

function getReferenceLabel(
  state: ReducedGraphState,
  kind: StoryEventAuthorityReferenceKind,
  id: string
): string | undefined {
  const memory = state.storyMemory
  if (kind === 'character') {
    return (
      state.characters?.find((character) => character.id === id)?.name ??
      memory?.entities.characters[id]?.name
    )
  }
  if (kind === 'item') return memory?.entities.items[id]?.name
  if (kind === 'location') return memory?.entities.locations[id]?.name
  if (kind === 'plot') {
    const currentAct = state.storyArc?.acts.find((act) => `act-${act.index}` === id)
    return memory?.entities.plots[id]?.name ?? currentAct?.title
  }
  if (kind === 'foreshadow') {
    return (
      state.foreshadowStack?.find((foreshadow) => foreshadow.id === id)?.text ??
      memory?.foreshadows[id]?.text
    )
  }
  if (kind === 'task') {
    return (
      state.storyState?.pendingTasks.find((task) => task.id === id)?.description ??
      memory?.tasks[id]?.description
    )
  }
  const currentAct = state.storyArc?.acts.find(
    (act) =>
      state.currentChapterIndex + 1 >= act.startChapter &&
      state.currentChapterIndex + 1 <= act.endChapter
  )
  if (!state.storyArc || !currentAct) return undefined
  const mandatoryBeat = getMandatoryBeatEntries(state.storyArc).find(
    (beat) => beat.actIndex === currentAct.index && beat.id === id
  )
  return (
    mandatoryBeat?.beat ??
    state.storyArc.keyBeats.find((beat) => beat.deadlineAct === currentAct.index && beat.id === id)
      ?.beat ??
    memory?.beats[id]?.description
  )
}

function buildAuthorityReferences(
  state: ReducedGraphState,
  selectedByKind: Array<{
    kind: StoryEventAuthorityReferenceKind
    ids: readonly string[]
  }>
): StoryEventAuthorityReference[] {
  const references: StoryEventAuthorityReference[] = []
  for (const { kind, ids } of selectedByKind) {
    let added = 0
    for (const id of ids) {
      if (added >= MAX_PLANNER_AUTHORITY_REFERENCES_PER_KIND) break
      const label = getReferenceLabel(state, kind, id)
      if (!label?.trim()) continue
      references.push({ kind, id, label: truncateReferenceLabel(label) })
      added++
    }
  }
  return references.sort(
    (left, right) =>
      REFERENCE_KIND_ORDER[left.kind] - REFERENCE_KIND_ORDER[right.kind] ||
      compareMachineStrings(left.id, right.id)
  )
}

export function buildStoryEventAuthorityRegistry(
  state: ReducedGraphState
): StoryEventAuthorityRegistry {
  const authority = collectStoryEventAuthority(state)
  const relevant = collectPlannerRelevantAuthority(state, authority)
  const characterIds = selectAuthorityIds(authority.characterIds, relevant.characterIds)
  const itemIds = selectAuthorityIds(authority.itemIds, relevant.itemIds)
  const locationIds = selectAuthorityIds(authority.locationIds, relevant.locationIds)
  const plotIds = selectAuthorityIds(authority.plotIds, relevant.plotIds)
  const beatIds = selectAuthorityIds(authority.beatIds, relevant.beatIds)
  const foreshadowIds = selectAuthorityIds(authority.foreshadowIds, relevant.foreshadowIds)
  const taskIds = selectAuthorityIds(authority.taskIds, relevant.taskIds)

  return {
    characterIds: characterIds.rendered,
    itemIds: itemIds.rendered,
    locationIds: locationIds.rendered,
    plotIds: plotIds.rendered,
    beatIds: beatIds.rendered,
    foreshadowIds: foreshadowIds.rendered,
    taskIds: taskIds.rendered,
    references: buildAuthorityReferences(state, [
      { kind: 'character', ids: characterIds.selected },
      { kind: 'item', ids: itemIds.selected },
      { kind: 'location', ids: locationIds.selected },
      { kind: 'plot', ids: plotIds.selected },
      { kind: 'beat', ids: beatIds.selected },
      { kind: 'foreshadow', ids: foreshadowIds.selected },
      { kind: 'task', ids: taskIds.selected },
    ]),
    omittedCounts: {
      characterIds: characterIds.omitted,
      itemIds: itemIds.omitted,
      locationIds: locationIds.omitted,
      plotIds: plotIds.omitted,
      beatIds: beatIds.omitted,
      foreshadowIds: foreshadowIds.omitted,
      taskIds: taskIds.omitted,
    },
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
