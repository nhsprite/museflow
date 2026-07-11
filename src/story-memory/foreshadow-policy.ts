import type { ForeshadowItem } from '../types/foreshadow.js'
import type {
  ForeshadowId,
  ForeshadowMemory,
  StoryEvent,
  StoryMemory,
} from '../types/story-memory.js'

type ForeshadowIntroduceEvent = Extract<StoryEvent, { type: 'foreshadow-introduce' }>

export interface ForeshadowBuckets {
  invalid: ForeshadowItem[]
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
    invalid: [],
    overdueRequired: [],
    dueRequired: [],
    normalRequired: [],
    optional: [],
  }

  for (const item of stack) {
    if (item.fulfilledChapter !== undefined) continue

    if (
      !Number.isInteger(item.expectedFulfillChapter) ||
      item.expectedFulfillChapter <= item.createdAtChapter
    ) {
      buckets.invalid.push(item)
    } else if (!item.required) {
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
  return getRequiredForeshadowsForScheduling(memory, boundaryChapter, isStoryEnd).map(
    (foreshadow) => foreshadow.id
  )
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
        left.id.localeCompare(right.id)
      )
    })
}

export function selectForeshadowsForChapter(
  memory: StoryMemory,
  chapterNumber: number,
  capacity: number,
  includeAllRequired: boolean
): ForeshadowId[] {
  const normalizedCapacity = Math.max(1, Math.floor(capacity))
  return getRequiredForeshadowsForScheduling(memory, chapterNumber, includeAllRequired)
    .slice(0, normalizedCapacity)
    .map((foreshadow) => foreshadow.id)
}
