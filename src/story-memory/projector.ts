import type {
  StoryMemory,
  StoryEvent,
  CharacterMemory,
  ItemMemory,
  LocationMemory,
  FactionMemory,
  ForeshadowMemory,
  BeatMemory,
  TaskMemory,
} from '../types/story-memory.js'
import type { StoryArc } from '../types/outline.js'
import type { StoryState, PendingTask } from '../types/story-state.js'
import { getMandatoryBeatEntries } from '../utils/mandatory-beat-ids.js'
import { isValidForeshadowDeadline } from './foreshadow-policy.js'

export function createEmptyStoryMemory(): StoryMemory {
  return {
    version: '1',
    lastChapterIndex: 0,
    entities: {
      characters: {},
      items: {},
      locations: {},
      factions: {},
      plots: {},
    },
    events: [],
    foreshadows: {},
    beats: {},
    tasks: {},
  }
}

/**
 * Pre-populate storyMemory beats from storyArc keyBeats so that each beat has
 * the correct actIndex. Without this, plot-advance events created by the writer
 * would produce BeatMemory entries with actIndex 0, which updateActProgress
 * ignores.
 */
export function ensureBeatsHaveActIndex(
  memory: StoryMemory,
  storyArc: StoryArc | null | undefined
): StoryMemory {
  if (!storyArc || storyArc.keyBeats.length === 0) return memory

  const beats: Record<string, BeatMemory> = { ...memory.beats }
  for (const mandatoryBeat of getMandatoryBeatEntries(storyArc)) {
    const existing = beats[mandatoryBeat.id]
    beats[mandatoryBeat.id] = {
      id: mandatoryBeat.id,
      description: mandatoryBeat.beat,
      actIndex: mandatoryBeat.actIndex,
      deadlineAct: mandatoryBeat.actIndex,
      required: existing?.required ?? true,
      claimedIn: existing?.claimedIn ?? null,
      provenByEventIds: existing?.provenByEventIds ?? [],
    }
  }

  for (const keyBeat of storyArc.keyBeats) {
    const existing = beats[keyBeat.id]
    beats[keyBeat.id] = {
      id: keyBeat.id,
      description: keyBeat.beat,
      actIndex: keyBeat.deadlineAct,
      deadlineAct: keyBeat.deadlineAct,
      required: keyBeat.required ?? existing?.required ?? true,
      claimedIn: existing?.claimedIn ?? null,
      provenByEventIds: existing?.provenByEventIds ?? [],
    }
  }
  return { ...memory, beats }
}

export function projectEntities(events: StoryEvent[]): StoryMemory['entities'] {
  const characters: Record<string, CharacterMemory> = {}
  const items: Record<string, ItemMemory> = {}
  const locations: Record<string, LocationMemory> = {}
  const factions: Record<string, FactionMemory> = {}

  // projectMemory handles foreshadow, plot, and task events.
  // projectEntities handles only entity state changes.
  for (const event of events) {
    switch (event.type) {
      case 'character-location':
        ensureCharacter(characters, event.characterId)
        characters[event.characterId]!.locationId = event.locationId
        break
      case 'character-status':
        ensureCharacter(characters, event.characterId)
        characters[event.characterId]!.status[event.attribute] = event.value
        break
      case 'item-location':
        ensureItem(items, event.itemId)
        items[event.itemId]!.holderId = event.holderId
        items[event.itemId]!.locationId = event.locationId
        break
      case 'item-state':
        ensureItem(items, event.itemId)
        items[event.itemId]!.state[event.attribute] = event.value
        break
    }
  }

  return { characters, items, locations, factions, plots: {} }
}

export function projectMemory(memory: StoryMemory): StoryMemory {
  const entities = projectEntities(memory.events)
  const foreshadows = projectForeshadows(memory.events)
  const beats = projectBeats(memory.events)
  const tasks = projectTasks(memory.events)
  const lastChapterIndex = computeLastChapterIndex(memory.events, memory.lastChapterIndex)

  return {
    ...memory,
    entities,
    foreshadows,
    beats,
    tasks,
    lastChapterIndex,
  }
}

export function applyEvents(memory: StoryMemory, events: StoryEvent[]): StoryMemory {
  const nextEvents = [...memory.events, ...events]
  const nextMemory: StoryMemory = {
    ...memory,
    events: nextEvents,
  }
  const projected = projectMemory(nextMemory)

  // projectMemory rebuilds beats from events, which loses actIndex/description
  // metadata for beats that were pre-populated from storyArc. Merge the original
  // beat metadata back in, keeping event-derived provenByEventIds and claimedIn.
  const mergedBeats: Record<string, BeatMemory> = {}
  for (const [id, original] of Object.entries(memory.beats)) {
    const updated = projected.beats[id]
    if (updated) {
      mergedBeats[id] = {
        ...original,
        provenByEventIds: updated.provenByEventIds,
        claimedIn: updated.claimedIn ?? original.claimedIn,
      }
    } else {
      mergedBeats[id] = original
    }
  }
  for (const [id, projectedBeat] of Object.entries(projected.beats)) {
    if (!mergedBeats[id]) {
      mergedBeats[id] = projectedBeat
    }
  }

  return { ...projected, beats: mergedBeats }
}

function createEmptyProjectedStoryState(): StoryState {
  return {
    characterLocations: {},
    characterStatus: {},
    keyItemsLocation: {},
    keyItemsState: {},
    activePlots: [],
    revealedSecrets: [],
    pendingTasks: [],
    currentScene: '',
    storyTime: '',
    canonicalFacts: [],
  }
}

function projectionValueToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

/**
 * StoryState exposes a single string per entity, while memory keeps a full
 * attribute record. Prefer the conventional key ('status' for characters,
 * 'state' for items) to preserve legacy behavior; otherwise fall back to the
 * last written attribute so non-standard attributes (injuries, mood, ...) are
 * not silently dropped from the projected state.
 */
function pickLatestAttributeValue(
  record: Record<string, unknown>,
  preferredKey: string
): string | undefined {
  const preferred = record[preferredKey]
  if (preferred !== undefined && preferred !== null) {
    return projectionValueToString(preferred)
  }
  const entries = Object.entries(record).filter(
    ([, value]) => value !== null && value !== undefined
  )
  const last = entries[entries.length - 1]
  return last ? projectionValueToString(last[1]) : undefined
}

export function projectStoryStateFromMemory(
  memory: StoryMemory,
  previousState?: StoryState | null
): StoryState {
  const base = previousState ?? createEmptyProjectedStoryState()
  const characterLocations = { ...base.characterLocations }
  const characterStatus = { ...base.characterStatus }
  const keyItemsLocation = { ...base.keyItemsLocation }
  const keyItemsState = { ...base.keyItemsState }

  // Entities only contain records for ids that appeared in events, but an
  // entity created by a status event has locationId null without any explicit
  // "cleared" signal. Track which ids actually had location events so a null
  // final location can delete the stale projected value without wiping base
  // values that came from other sources (e.g. author overrides).
  const charactersWithLocationEvents = new Set<string>()
  const itemsWithLocationEvents = new Set<string>()
  for (const event of memory.events) {
    if (event.type === 'character-location') {
      charactersWithLocationEvents.add(event.characterId)
    } else if (event.type === 'item-location') {
      itemsWithLocationEvents.add(event.itemId)
    }
  }

  for (const character of Object.values(memory.entities.characters)) {
    if (character.locationId) {
      characterLocations[character.id] = character.locationId
    } else if (charactersWithLocationEvents.has(character.id)) {
      delete characterLocations[character.id]
    }
    const status = pickLatestAttributeValue(character.status, 'status')
    if (status !== undefined) {
      characterStatus[character.id] = status
    }
  }

  for (const item of Object.values(memory.entities.items)) {
    // locationId is the canonical item location; holderId is supplementary
    // metadata about who is holding it. Prefer locationId so that a fixed
    // location (e.g. a drawer) is not overridden just because a character
    // handled the item there.
    const location = item.locationId ?? item.holderId
    if (location) {
      keyItemsLocation[item.id] = location
    } else if (itemsWithLocationEvents.has(item.id)) {
      delete keyItemsLocation[item.id]
    }
    const state = pickLatestAttributeValue(item.state, 'state')
    if (state !== undefined) {
      keyItemsState[item.id] = state
    }
  }

  const pendingTasksById = new Map<string, PendingTask>()
  for (const task of base.pendingTasks ?? []) {
    pendingTasksById.set(task.id, task)
  }
  for (const task of Object.values(memory.tasks)) {
    const existing = pendingTasksById.get(task.id)
    pendingTasksById.set(task.id, {
      id: task.id,
      assignee: existing?.assignee ?? '',
      description: task.description,
      createdChapter: task.createdIn + 1,
      status: task.resolvedIn === null ? (existing?.status ?? 'pending') : 'done',
      ...(existing?.dueChapter !== undefined ? { dueChapter: existing.dueChapter } : {}),
      ...(existing?.dueTime !== undefined ? { dueTime: existing.dueTime } : {}),
    })
  }

  return {
    ...base,
    characterLocations,
    characterStatus,
    keyItemsLocation,
    keyItemsState,
    pendingTasks: Array.from(pendingTasksById.values()).sort(
      (a, b) => a.createdChapter - b.createdChapter
    ),
  }
}

function projectForeshadows(events: StoryEvent[]): Record<string, ForeshadowMemory> {
  const foreshadows: Record<string, ForeshadowMemory> = {}

  for (const event of events) {
    if (event.type === 'foreshadow-introduce') {
      if (!isValidForeshadowDeadline(event.chapterIndex, event.expectedFulfillChapter)) {
        continue
      }
      const existing = foreshadows[event.foreshadowId]
      foreshadows[event.foreshadowId] = {
        ...existing,
        id: event.foreshadowId,
        text: event.text ?? existing?.text ?? event.foreshadowId,
        kind: event.kind ?? existing?.kind ?? null,
        introducedIn: event.chapterIndex,
        expectedFulfillChapter: event.expectedFulfillChapter,
        fulfilledIn: existing?.fulfilledIn ?? null,
        required: event.required ?? existing?.required ?? true,
        beatId: event.beatId ?? existing?.beatId ?? null,
      }
    } else if (event.type === 'foreshadow-fulfill') {
      const existing = foreshadows[event.foreshadowId]
      foreshadows[event.foreshadowId] = {
        id: event.foreshadowId,
        text: existing?.text ?? event.foreshadowId,
        kind: existing?.kind ?? null,
        introducedIn: existing?.introducedIn ?? event.chapterIndex,
        expectedFulfillChapter: existing?.expectedFulfillChapter ?? null,
        fulfilledIn: event.chapterIndex,
        required: existing?.required ?? true,
        beatId: existing?.beatId ?? null,
        ...(existing?.deadlineExtensions !== undefined
          ? { deadlineExtensions: existing.deadlineExtensions }
          : {}),
      }
    } else if (event.type === 'foreshadow-deadline-extend') {
      const existing = foreshadows[event.foreshadowId]
      if (!existing) continue
      foreshadows[event.foreshadowId] = {
        ...existing,
        expectedFulfillChapter: event.newExpectedFulfillChapter,
        deadlineExtensions: (existing.deadlineExtensions ?? 0) + 1,
      }
    }
  }

  return foreshadows
}

function projectBeats(events: StoryEvent[]): Record<string, BeatMemory> {
  const beats: Record<string, BeatMemory> = {}

  for (const event of events) {
    if (event.type === 'plot-advance') {
      const existing = beats[event.beatId]
      beats[event.beatId] = {
        id: event.beatId,
        description: existing?.description ?? event.beatId,
        actIndex: existing?.actIndex ?? 0,
        deadlineAct: existing?.deadlineAct ?? 0,
        required: existing?.required ?? true,
        claimedIn: existing?.claimedIn ?? event.chapterIndex,
        provenByEventIds: [...(existing?.provenByEventIds ?? []), event.id],
      }
    }
  }

  return beats
}

function projectTasks(events: StoryEvent[]): Record<string, TaskMemory> {
  const tasks: Record<string, TaskMemory> = {}

  for (const event of events) {
    if (event.type === 'task-create') {
      tasks[event.taskId] = {
        id: event.taskId,
        description: event.description,
        createdIn: event.chapterIndex,
        resolvedIn: tasks[event.taskId]?.resolvedIn ?? null,
      }
    } else if (event.type === 'task-resolve') {
      const existing = tasks[event.taskId]
      tasks[event.taskId] = {
        id: event.taskId,
        description: existing?.description ?? event.taskId,
        createdIn: existing?.createdIn ?? event.chapterIndex,
        resolvedIn: event.chapterIndex,
      }
    }
  }

  return tasks
}

export function computeLastChapterIndex(events: StoryEvent[], fallback: number): number {
  if (events.length === 0) return fallback
  return events.reduce((max, event) => Math.max(max, event.chapterIndex), fallback)
}

function ensureCharacter(characters: Record<string, CharacterMemory>, id: string) {
  if (!characters[id]) {
    characters[id] = {
      id,
      name: id,
      locationId: null,
      status: {},
      introducedIn: 0,
    }
  }
}

function ensureItem(items: Record<string, ItemMemory>, id: string) {
  if (!items[id]) {
    items[id] = {
      id,
      name: id,
      holderId: null,
      locationId: null,
      state: {},
      introducedIn: 0,
    }
  }
}
