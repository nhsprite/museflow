import type { ForeshadowItem } from '../types/foreshadow.js'
import type {
  ForeshadowId,
  ForeshadowMemory,
  StoryEvent,
  StoryMemory,
} from '../types/story-memory.js'

type ForeshadowIntroduceEvent = Extract<StoryEvent, { type: 'foreshadow-introduce' }>

export interface ForeshadowBuckets {
  overdueRequired: ForeshadowItem[]
  dueRequired: ForeshadowItem[]
  normalRequired: ForeshadowItem[]
  optional: ForeshadowItem[]
}

export function isValidForeshadowDeadline(
  introducedChapterIndex: number,
  expectedFulfillChapter: number | null
): boolean {
  return (
    expectedFulfillChapter === null ||
    (Number.isInteger(expectedFulfillChapter) &&
      expectedFulfillChapter > introducedChapterIndex + 1)
  )
}

export function classifyForeshadows(
  stack: ForeshadowItem[],
  currentChapter: number
): ForeshadowBuckets {
  const buckets: ForeshadowBuckets = {
    overdueRequired: [],
    dueRequired: [],
    normalRequired: [],
    optional: [],
  }

  for (const item of stack) {
    if (item.fulfilledChapter !== undefined) continue
    if (!isValidForeshadowDeadline(item.createdAtChapter, item.expectedFulfillChapter)) continue

    if (!item.required) {
      buckets.optional.push(item)
    } else if (currentChapter > item.expectedFulfillChapter + 1) {
      buckets.overdueRequired.push(item)
    } else if (currentChapter >= item.expectedFulfillChapter - 1) {
      buckets.dueRequired.push(item)
    } else {
      buckets.normalRequired.push(item)
    }
  }

  return buckets
}

export function partitionInvalidForeshadowIntroductions(events: StoryEvent[]): {
  valid: StoryEvent[]
  invalid: ForeshadowIntroduceEvent[]
} {
  const valid: StoryEvent[] = []
  const invalid: ForeshadowIntroduceEvent[] = []

  for (const event of events) {
    if (
      event.type === 'foreshadow-introduce' &&
      !isValidForeshadowDeadline(event.chapterIndex, event.expectedFulfillChapter)
    ) {
      invalid.push(event)
    } else {
      valid.push(event)
    }
  }

  return { valid, invalid }
}

export function getBoundaryBlockingForeshadows(
  memory: StoryMemory,
  boundaryChapter: number,
  isStoryEnd: boolean
): ForeshadowId[] {
  return getBoundaryBlockingForeshadowDetails(memory, boundaryChapter, isStoryEnd).map(
    (foreshadow) => foreshadow.id
  )
}

export function getBoundaryBlockingForeshadowDetails(
  memory: StoryMemory,
  boundaryChapter: number,
  isStoryEnd: boolean
): ForeshadowMemory[] {
  return getRequiredForeshadowsForScheduling(memory, boundaryChapter, isStoryEnd)
}

export function getRequiredForeshadowsForScheduling(
  memory: StoryMemory,
  chapterNumber: number,
  includeAllRequired: boolean
): ForeshadowMemory[] {
  return Object.values(memory.foreshadows)
    .filter((foreshadow) => {
      if (
        !foreshadow.required ||
        foreshadow.fulfilledIn !== null ||
        foreshadow.waivedIn !== undefined ||
        !isValidForeshadowDeadline(foreshadow.introducedIn, foreshadow.expectedFulfillChapter)
      ) {
        return false
      }

      return (
        includeAllRequired ||
        (foreshadow.expectedFulfillChapter !== null &&
          foreshadow.expectedFulfillChapter <= chapterNumber)
      )
    })
    .sort((left, right) => {
      const leftDeadline = left.expectedFulfillChapter
      const rightDeadline = right.expectedFulfillChapter

      if (leftDeadline === null && rightDeadline !== null) return 1
      if (leftDeadline !== null && rightDeadline === null) return -1

      return (
        (leftDeadline ?? 0) - (rightDeadline ?? 0) ||
        left.introducedIn - right.introducedIn ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      )
    })
}

export function normalizeForeshadowCapacity(capacity: number): number {
  return Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : 1
}

export function selectForeshadowsForChapter(
  memory: StoryMemory,
  chapterNumber: number,
  capacity: number,
  includeAllRequired: boolean
): ForeshadowId[] {
  const normalizedCapacity = normalizeForeshadowCapacity(capacity)
  return getRequiredForeshadowsForScheduling(memory, chapterNumber, includeAllRequired)
    .slice(0, normalizedCapacity)
    .map((foreshadow) => foreshadow.id)
}

export interface OpportunisticForeshadowSelectionOptions {
  chapterNumber: number
  minFulfillDistance: number
  capacity: number
  excludedIds?: ReadonlySet<ForeshadowId>
  lastConsideredChapterById?: ReadonlyMap<ForeshadowId, number>
}

export function selectOpportunisticForeshadowsForChapter(
  memory: StoryMemory,
  options: OpportunisticForeshadowSelectionOptions
): ForeshadowId[] {
  const capacity = Number.isFinite(options.capacity)
    ? Math.max(0, Math.floor(options.capacity))
    : 0
  if (capacity === 0) return []

  const minFulfillDistance = Number.isFinite(options.minFulfillDistance)
    ? Math.max(0, Math.floor(options.minFulfillDistance))
    : 0
  const excludedIds = options.excludedIds ?? new Set<ForeshadowId>()
  const lastConsideredChapterById =
    options.lastConsideredChapterById ?? new Map<ForeshadowId, number>()

  return Object.values(memory.foreshadows)
    .filter(
      (foreshadow) =>
        foreshadow.expectedFulfillChapter === null &&
        foreshadow.fulfilledIn === null &&
        foreshadow.waivedIn === undefined &&
        !excludedIds.has(foreshadow.id) &&
        options.chapterNumber >= foreshadow.introducedIn + 1 + minFulfillDistance
    )
    .sort((left, right) => {
      const leftLastConsidered =
        lastConsideredChapterById.get(left.id) ?? Number.NEGATIVE_INFINITY
      const rightLastConsidered =
        lastConsideredChapterById.get(right.id) ?? Number.NEGATIVE_INFINITY
      if (leftLastConsidered !== rightLastConsidered) {
        return leftLastConsidered - rightLastConsidered
      }
      if (left.required !== right.required) return left.required ? -1 : 1
      return (
        left.introducedIn - right.introducedIn ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      )
    })
    .slice(0, capacity)
    .map((foreshadow) => foreshadow.id)
}
