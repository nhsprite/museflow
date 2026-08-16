import type {
  StoryMemory,
  StoryEvent,
  ForeshadowId,
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
import { getCoveredMandatoryBeatId } from '../utils/beat-coverage.js'
import { isProjectableForeshadowIntroduction } from './foreshadow-introduction.js'
import {
  compareCanonicalOrder,
  ForeshadowMergeValidationError,
  resolveCanonicalForeshadowId,
} from './foreshadow-alias.js'
import { deriveLegacyRequired, normalizeLegacyForeshadowFields } from './resolution-policy.js'
import { lifecycleChannelFromStatusEvent } from './lifecycle.js'
import { normalizeStoryTime } from '../utils/story-time.js'

export function createEmptyStoryMemory(): StoryMemory {
  return {
    version: '3',
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
 * Pre-populate storyMemory beats from stable mandatory and global key beat IDs
 * so each beat has the correct actIndex. Without this, plot-advance events
 * created by the writer would produce BeatMemory entries with actIndex 0.
 */
export function ensureBeatsHaveActIndex(
  memory: StoryMemory,
  storyArc: StoryArc | null | undefined
): StoryMemory {
  if (!storyArc) return memory

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
      // D.2.3 佐证审计记录随重建保留；缺省维持 grandfathered 语义。
      ...(existing?.corroboration ? { corroboration: existing.corroboration } : {}),
    }
  }

  for (const keyBeat of storyArc.keyBeats) {
    if (getCoveredMandatoryBeatId(storyArc, keyBeat.id) !== undefined) continue
    const existing = beats[keyBeat.id]
    beats[keyBeat.id] = {
      id: keyBeat.id,
      description: keyBeat.beat,
      actIndex: keyBeat.deadlineAct,
      deadlineAct: keyBeat.deadlineAct,
      required: keyBeat.required ?? existing?.required ?? true,
      claimedIn: existing?.claimedIn ?? null,
      provenByEventIds: existing?.provenByEventIds ?? [],
      ...(existing?.corroboration ? { corroboration: existing.corroboration } : {}),
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
        ensureLocation(locations, event.locationId, event.chapterIndex)
        break
      case 'character-status': {
        ensureCharacter(characters, event.characterId)
        const character = characters[event.characterId]!
        character.status[event.attribute] = event.value
        const channel = lifecycleChannelFromStatusEvent(event)
        if (channel) {
          // 终态单调：alive 一旦为 false，普通 status 事件不得翻回 true；
          // 只有显式 character-revival 事件可以清除终态标记。
          const current = character.lifecycle?.[channel.attribute]
          const blockedFlip =
            channel.attribute === 'alive' && current === false && channel.value === true
          if (!blockedFlip) {
            character.lifecycle = { ...character.lifecycle, [channel.attribute]: channel.value }
          }
        }
        break
      }
      case 'character-revival': {
        // 显式复活：唯一合法的终态反转通道，消费后清除 alive 终态标记。
        ensureCharacter(characters, event.characterId)
        const character = characters[event.characterId]!
        character.lifecycle = { ...character.lifecycle, alive: true }
        break
      }
      case 'entity-register': {
        // 实体注册（B.3）：注册后实体获得真实 id 与可读名，进入位置/状态投影。
        // 若实体已被先前事件以占位名（name=id）自动建立，注册负责回填可读名与引入章节。
        if (event.entityKind === 'character') {
          ensureCharacter(characters, event.entityId)
          const character = characters[event.entityId]!
          if (character.name === character.id) character.name = event.displayName
          if (character.introducedIn === 0) character.introducedIn = event.chapterIndex
        } else {
          ensureItem(items, event.entityId)
          const item = items[event.entityId]!
          if (item.name === item.id) item.name = event.displayName
          if (item.introducedIn === 0) item.introducedIn = event.chapterIndex
        }
        break
      }
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

  // item-location 的 locationId 可能是角色 id（随身携带语义），只把真正的地点登记进注册表。
  // 在事件全部处理完后判断，此时角色/物品集合已完整。
  for (const event of events) {
    if (event.type !== 'item-location' || !event.locationId) continue
    if (characters[event.locationId] || items[event.locationId]) continue
    ensureLocation(locations, event.locationId, event.chapterIndex)
  }

  return { characters, items, locations, factions, plots: {} }
}

/**
 * 存量回填（B.1）：旧 checkpoint 的实体投影缺少 lifecycle 终态标记。
 * 仅从事件流的结构化数据（lifecycle 通道、attribute 命中受控词表且布尔值、
 * character-revival 事件）重新推导并覆盖到实体投影；自由文本状态不做任何猜测。
 * 幂等：投影本就由事件流决定，重复调用结果不变。
 */
export function backfillLifecycleProjection(memory: StoryMemory): StoryMemory {
  const projected = projectEntities(memory.events)
  let changed = false
  const characters: Record<string, CharacterMemory> = { ...memory.entities.characters }
  for (const [id, projectedCharacter] of Object.entries(projected.characters)) {
    if (projectedCharacter.lifecycle === undefined) continue
    const existing = characters[id]
    if (!existing) continue
    if (
      JSON.stringify(existing.lifecycle ?? null) === JSON.stringify(projectedCharacter.lifecycle)
    ) {
      continue
    }
    characters[id] = { ...existing, lifecycle: projectedCharacter.lifecycle }
    changed = true
  }
  if (!changed) return memory
  return { ...memory, entities: { ...memory.entities, characters } }
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
    storyTime: {},
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
    // B.4：旧 checkpoint 的自由文本 storyTime 在读取路径归一化为结构化 { freeform }。
    storyTime: normalizeStoryTime(base.storyTime),
    pendingTasks: Array.from(pendingTasksById.values()).sort(
      (a, b) => a.createdChapter - b.createdChapter
    ),
  }
}

function projectForeshadows(events: StoryEvent[]): Record<string, ForeshadowMemory> {
  const foreshadows: Record<string, ForeshadowMemory> = {}
  const introducedIds = new Set<ForeshadowId>()

  for (const event of events) {
    if (event.type === 'foreshadow-introduce') {
      if (!isProjectableForeshadowIntroduction(event)) {
        continue
      }
      introducedIds.add(event.foreshadowId)
      const existing = foreshadows[event.foreshadowId]
      const normalized = event.resolutionPolicy
        ? {
            resolutionPolicy: event.resolutionPolicy,
            expectedFulfillChapter: event.expectedFulfillChapter,
          }
        : normalizeLegacyForeshadowFields(event.required, event.expectedFulfillChapter)
      foreshadows[event.foreshadowId] = {
        ...existing,
        id: event.foreshadowId,
        text: event.text ?? existing?.text ?? event.foreshadowId,
        kind: event.kind ?? existing?.kind ?? null,
        introducedIn: event.chapterIndex,
        expectedFulfillChapter: normalized.expectedFulfillChapter,
        fulfilledIn: existing?.fulfilledIn ?? null,
        resolutionPolicy: normalized.resolutionPolicy,
        ...(event.resolutionQuestion !== undefined
          ? { resolutionQuestion: event.resolutionQuestion }
          : {}),
        ...(event.fulfillmentCriteria !== undefined
          ? { fulfillmentCriteria: event.fulfillmentCriteria }
          : {}),
        required: deriveLegacyRequired(normalized.resolutionPolicy),
        beatId: event.beatId ?? existing?.beatId ?? null,
      }
    } else if (event.type === 'foreshadow-fulfill') {
      const addressed = foreshadows[event.foreshadowId]
      const targetId = addressed
        ? resolveProjectedForeshadowId(events, foreshadows, event.foreshadowId)
        : event.foreshadowId
      const existing = foreshadows[targetId]
      if (existing) {
        foreshadows[targetId] = {
          ...existing,
          fulfilledIn:
            existing.fulfilledIn === null
              ? event.chapterIndex
              : Math.min(existing.fulfilledIn, event.chapterIndex),
        }
      } else {
        foreshadows[targetId] = {
          id: targetId,
          text: targetId,
          kind: null,
          introducedIn: event.chapterIndex,
          expectedFulfillChapter: null,
          fulfilledIn: event.chapterIndex,
          resolutionPolicy: 'should_resolve',
          required: deriveLegacyRequired('should_resolve'),
          beatId: null,
        }
      }
    } else if (event.type === 'foreshadow-deadline-extend') {
      const existing = foreshadows[event.foreshadowId]
      if (!existing) continue
      foreshadows[event.foreshadowId] = {
        ...existing,
        expectedFulfillChapter: event.newExpectedFulfillChapter,
        deadlineExtensions: (existing.deadlineExtensions ?? 0) + 1,
      }
    } else if (event.type === 'foreshadow-policy-set') {
      const existing = foreshadows[event.foreshadowId]
      if (!existing || existing.fulfilledIn !== null || existing.waivedIn !== undefined) continue
      foreshadows[event.foreshadowId] = {
        ...existing,
        resolutionPolicy: event.resolutionPolicy,
        expectedFulfillChapter: event.expectedFulfillChapter,
        required: deriveLegacyRequired(event.resolutionPolicy),
      }
    } else if (event.type === 'foreshadow-waive') {
      const existing = foreshadows[event.foreshadowId]
      if (!existing) continue
      foreshadows[event.foreshadowId] = {
        ...existing,
        waivedIn: event.chapterIndex,
      }
    } else if (event.type === 'foreshadow-merge') {
      projectForeshadowMerge(events, foreshadows, introducedIds, event)
    }
  }

  return foreshadows
}

function projectForeshadowMerge(
  events: StoryEvent[],
  foreshadows: Record<ForeshadowId, ForeshadowMemory>,
  introducedIds: ReadonlySet<ForeshadowId>,
  event: Extract<StoryEvent, { type: 'foreshadow-merge' }>
): void {
  const canonical = foreshadows[event.canonicalForeshadowId]
  const duplicate = foreshadows[event.duplicateForeshadowId]
  if (
    !canonical ||
    !duplicate ||
    !introducedIds.has(event.canonicalForeshadowId) ||
    !introducedIds.has(event.duplicateForeshadowId)
  ) {
    throw new ForeshadowMergeValidationError(
      `Cannot merge unintroduced foreshadow ids: ${event.canonicalForeshadowId}, ${event.duplicateForeshadowId}`
    )
  }
  if (duplicate.mergedInto !== undefined) {
    throw new ForeshadowMergeValidationError(
      `Duplicate foreshadow id is already merged: ${event.duplicateForeshadowId}`
    )
  }

  const memory = createForeshadowProjectionMemory(events, foreshadows)
  const canonicalRootId = resolveCanonicalForeshadowId(memory, event.canonicalForeshadowId)
  const duplicateRootId = resolveCanonicalForeshadowId(memory, event.duplicateForeshadowId)
  if (canonicalRootId === null || duplicateRootId === null) {
    throw new ForeshadowMergeValidationError(
      `Cannot resolve foreshadow merge ids: ${event.canonicalForeshadowId}, ${event.duplicateForeshadowId}`
    )
  }
  if (canonicalRootId === duplicateRootId) {
    throw new ForeshadowMergeValidationError(
      `Foreshadow ids already share canonical root: ${canonicalRootId}`
    )
  }
  if (compareCanonicalOrder(memory, canonicalRootId, duplicateRootId) >= 0) {
    throw new ForeshadowMergeValidationError(
      `Canonical foreshadow must precede duplicate: ${canonicalRootId}, ${duplicateRootId}`
    )
  }

  const root = foreshadows[canonicalRootId]
  if (!root) {
    throw new ForeshadowMergeValidationError(
      `Canonical foreshadow root is unknown: ${canonicalRootId}`
    )
  }

  duplicate.mergedInto = canonicalRootId
  if (duplicate.fulfilledIn !== null) {
    root.fulfilledIn =
      root.fulfilledIn === null
        ? duplicate.fulfilledIn
        : Math.min(root.fulfilledIn, duplicate.fulfilledIn)
  }
  flattenProjectedAliases(events, foreshadows)
}

function resolveProjectedForeshadowId(
  events: StoryEvent[],
  foreshadows: Record<ForeshadowId, ForeshadowMemory>,
  id: ForeshadowId
): ForeshadowId {
  const resolved = resolveCanonicalForeshadowId(
    createForeshadowProjectionMemory(events, foreshadows),
    id
  )
  if (resolved === null) {
    throw new ForeshadowMergeValidationError(`Invalid foreshadow alias chain: ${id}`)
  }
  return resolved
}

function flattenProjectedAliases(
  events: StoryEvent[],
  foreshadows: Record<ForeshadowId, ForeshadowMemory>
): void {
  const memory = createForeshadowProjectionMemory(events, foreshadows)
  for (const foreshadow of Object.values(foreshadows)) {
    if (foreshadow.mergedInto === undefined) continue
    const rootId = resolveCanonicalForeshadowId(memory, foreshadow.id)
    if (rootId === null) {
      throw new ForeshadowMergeValidationError(`Invalid foreshadow alias chain: ${foreshadow.id}`)
    }
    foreshadow.mergedInto = rootId
  }
}

function createForeshadowProjectionMemory(
  events: StoryEvent[],
  foreshadows: Record<ForeshadowId, ForeshadowMemory>
): StoryMemory {
  return {
    version: '3',
    lastChapterIndex: 0,
    entities: {
      characters: {},
      items: {},
      locations: {},
      factions: {},
      plots: {},
    },
    events,
    foreshadows,
    beats: {},
    tasks: {},
  }
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

function ensureLocation(
  locations: Record<string, LocationMemory>,
  id: string | null,
  chapterIndex: number
) {
  if (!id) return
  if (!locations[id]) {
    // name 直接沿用机器 id：不做任何自然语言推断，可读名由后续人工/迁移工具补充。
    locations[id] = { id, name: id, introducedIn: chapterIndex }
  }
}
