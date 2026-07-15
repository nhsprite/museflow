import type { ForeshadowId, ForeshadowMemory, StoryMemory } from '../types/story-memory.js'

interface ForeshadowIntroductionOrder {
  chapterIndex: number
  eventPosition: number
}

export class ForeshadowMergeValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForeshadowMergeValidationError'
  }
}

export function resolveCanonicalForeshadowId(
  memory: StoryMemory,
  id: ForeshadowId
): ForeshadowId | null {
  const visited = new Set<ForeshadowId>()
  let currentId = id

  while (true) {
    if (visited.has(currentId)) return null
    visited.add(currentId)

    const current = memory.foreshadows[currentId]
    if (!current || current.id !== currentId) return null
    if (current.mergedInto === undefined) return currentId

    currentId = current.mergedInto
  }
}

export function getCanonicalForeshadows(memory: StoryMemory): ForeshadowMemory[] {
  const canonical: ForeshadowMemory[] = []

  for (const [id, foreshadow] of Object.entries(memory.foreshadows)) {
    if (resolveCanonicalForeshadowId(memory, id) === id) {
      canonical.push(foreshadow)
    }
  }

  return canonical.sort((left, right) => compareCanonicalOrder(memory, left.id, right.id))
}

export function canonicalizeForeshadowIds(
  memory: StoryMemory,
  ids: readonly ForeshadowId[]
): ForeshadowId[] {
  const canonicalIds: ForeshadowId[] = []
  const seen = new Set<ForeshadowId>()

  for (const id of ids) {
    const canonicalId = resolveCanonicalForeshadowId(memory, id)
    if (canonicalId === null || seen.has(canonicalId)) continue
    seen.add(canonicalId)
    canonicalIds.push(canonicalId)
  }

  return canonicalIds
}

export function compareCanonicalOrder(
  memory: StoryMemory,
  leftId: ForeshadowId,
  rightId: ForeshadowId
): number {
  if (leftId === rightId) return 0

  const left = getIntroductionOrder(memory, leftId)
  const right = getIntroductionOrder(memory, rightId)
  const chapterOrder = compareNumbers(left.chapterIndex, right.chapterIndex)
  if (chapterOrder !== 0) return chapterOrder

  const positionOrder = compareNumbers(left.eventPosition, right.eventPosition)
  if (positionOrder !== 0) return positionOrder

  return leftId < rightId ? -1 : 1
}

function compareNumbers(left: number, right: number): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function getIntroductionOrder(memory: StoryMemory, id: ForeshadowId): ForeshadowIntroductionOrder {
  for (let eventPosition = 0; eventPosition < memory.events.length; eventPosition += 1) {
    const event = memory.events[eventPosition]
    if (event?.type === 'foreshadow-introduce' && event.foreshadowId === id) {
      return { chapterIndex: event.chapterIndex, eventPosition }
    }
  }

  return {
    chapterIndex: memory.foreshadows[id]?.introducedIn ?? Number.POSITIVE_INFINITY,
    eventPosition: Number.POSITIVE_INFINITY,
  }
}
