import type { StoryEvent, StoryMemory, EntityId } from '../types/story-memory.js'

export interface EventDiff {
  missing: StoryEvent[]
  unexpected: StoryEvent[]
  matched: StoryEvent[]
}

export function diffEvents(expected: StoryEvent[], actual: StoryEvent[]): EventDiff {
  const matched: StoryEvent[] = []
  const unexpected: StoryEvent[] = []
  const used = new Set<number>()

  for (const a of actual) {
    const index = expected.findIndex((e, i) => !used.has(i) && eventsMatch(e, a))
    if (index >= 0) {
      used.add(index)
      matched.push(a)
    } else {
      unexpected.push(a)
    }
  }

  const missing = expected.filter((_, i) => !used.has(i))
  return { missing, unexpected, matched }
}

function eventsMatch(a: StoryEvent, b: StoryEvent): boolean {
  if (a.type !== b.type) return false
  if (a.chapterIndex !== b.chapterIndex) return false

  switch (a.type) {
    case 'character-location':
      return (
        b.type === 'character-location' &&
        a.characterId === b.characterId &&
        a.locationId === b.locationId
      )
    case 'character-status':
      return (
        b.type === 'character-status' &&
        a.characterId === b.characterId &&
        a.attribute === b.attribute &&
        JSON.stringify(a.value) === JSON.stringify(b.value)
      )
    case 'item-location':
      return (
        b.type === 'item-location' &&
        a.itemId === b.itemId &&
        a.holderId === b.holderId &&
        a.locationId === b.locationId
      )
    case 'item-state':
      return (
        b.type === 'item-state' &&
        a.itemId === b.itemId &&
        a.attribute === b.attribute &&
        JSON.stringify(a.value) === JSON.stringify(b.value)
      )
    case 'plot-advance':
      return b.type === 'plot-advance' && a.beatId === b.beatId && a.plotId === b.plotId
    case 'foreshadow-introduce':
      return (
        b.type === 'foreshadow-introduce' &&
        a.foreshadowId === b.foreshadowId &&
        a.expectedFulfillChapter === b.expectedFulfillChapter &&
        a.resolutionPolicy === b.resolutionPolicy
      )
    case 'foreshadow-fulfill':
      return b.type === 'foreshadow-fulfill' && a.foreshadowId === b.foreshadowId
    case 'foreshadow-deadline-extend':
      return (
        b.type === 'foreshadow-deadline-extend' &&
        a.foreshadowId === b.foreshadowId &&
        a.newExpectedFulfillChapter === b.newExpectedFulfillChapter
      )
    case 'foreshadow-policy-set':
      return (
        b.type === 'foreshadow-policy-set' &&
        a.foreshadowId === b.foreshadowId &&
        a.resolutionPolicy === b.resolutionPolicy &&
        a.expectedFulfillChapter === b.expectedFulfillChapter
      )
    case 'foreshadow-waive':
      return b.type === 'foreshadow-waive' && a.foreshadowId === b.foreshadowId
    case 'task-create':
      return b.type === 'task-create' && a.taskId === b.taskId && a.description === b.description
    case 'task-resolve':
      return b.type === 'task-resolve' && a.taskId === b.taskId
    default:
      return false
  }
}

export interface StateSnapshotDiff {
  characterLocations: Array<{ id: EntityId; before: string | null; after: string | null }>
  itemHolders: Array<{ id: EntityId; before: string | null; after: string | null }>
  itemLocations: Array<{ id: EntityId; before: string | null; after: string | null }>
  newForeshadows: string[]
  fulfilledForeshadows: string[]
  newTasks: string[]
  resolvedTasks: string[]
}

export function diffMemorySnapshots(before: StoryMemory, after: StoryMemory): StateSnapshotDiff {
  const characterLocations: StateSnapshotDiff['characterLocations'] = []
  for (const id of new Set([
    ...Object.keys(before.entities.characters),
    ...Object.keys(after.entities.characters),
  ])) {
    const beforeLoc = before.entities.characters[id]?.locationId ?? null
    const afterLoc = after.entities.characters[id]?.locationId ?? null
    if (beforeLoc !== afterLoc) {
      characterLocations.push({ id, before: beforeLoc, after: afterLoc })
    }
  }

  const itemHolders: StateSnapshotDiff['itemHolders'] = []
  for (const id of new Set([
    ...Object.keys(before.entities.items),
    ...Object.keys(after.entities.items),
  ])) {
    const beforeHolder = before.entities.items[id]?.holderId ?? null
    const afterHolder = after.entities.items[id]?.holderId ?? null
    if (beforeHolder !== afterHolder) {
      itemHolders.push({ id, before: beforeHolder, after: afterHolder })
    }
  }

  const itemLocations: StateSnapshotDiff['itemLocations'] = []
  for (const id of new Set([
    ...Object.keys(before.entities.items),
    ...Object.keys(after.entities.items),
  ])) {
    const beforeLocation = before.entities.items[id]?.locationId ?? null
    const afterLocation = after.entities.items[id]?.locationId ?? null
    if (beforeLocation !== afterLocation) {
      itemLocations.push({ id, before: beforeLocation, after: afterLocation })
    }
  }

  const newForeshadows = Object.values(after.foreshadows)
    .filter((f) => !before.foreshadows[f.id])
    .map((f) => f.id)

  const fulfilledForeshadows = Object.values(after.foreshadows)
    .filter(
      (f) => f.fulfilledIn !== null && (before.foreshadows[f.id]?.fulfilledIn ?? null) === null
    )
    .map((f) => f.id)

  const newTasks = Object.values(after.tasks)
    .filter((t) => !before.tasks[t.id])
    .map((t) => t.id)

  const resolvedTasks = Object.values(after.tasks)
    .filter((t) => t.resolvedIn !== null && (before.tasks[t.id]?.resolvedIn ?? null) === null)
    .map((t) => t.id)

  return {
    characterLocations,
    itemHolders,
    itemLocations,
    newForeshadows,
    fulfilledForeshadows,
    newTasks,
    resolvedTasks,
  }
}
