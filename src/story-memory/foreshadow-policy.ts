import type { ForeshadowItem } from '../types/foreshadow.js'
import type { ForeshadowId, StoryEvent, StoryMemory } from '../types/story-memory.js'
import type { StoryArc } from '../types/outline.js'

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
  storyArc: StoryArc | null | undefined,
  actIndex: number,
  isStoryEnd: boolean
): ForeshadowId[] {
  const blocking: ForeshadowId[] = []
  const keyBeatDeadlineByForeshadow = new Map<ForeshadowId, number>()
  for (const keyBeat of storyArc?.keyBeats ?? []) {
    if (keyBeat.foreshadowId) {
      keyBeatDeadlineByForeshadow.set(keyBeat.foreshadowId, keyBeat.deadlineAct)
    }
  }

  for (const foreshadow of Object.values(memory.foreshadows)) {
    if (
      !foreshadow.required ||
      foreshadow.fulfilledIn !== null ||
      !isValidForeshadowDeadline(foreshadow.introducedIn, foreshadow.expectedFulfillChapter)
    ) {
      continue
    }

    if (isStoryEnd) {
      blocking.push(foreshadow.id)
      continue
    }

    const memoryBeat = foreshadow.beatId ? memory.beats[foreshadow.beatId] : undefined
    const keyBeatDeadline = keyBeatDeadlineByForeshadow.get(foreshadow.id)
    const belongsToClosedAct =
      (memoryBeat !== undefined &&
        (memoryBeat.actIndex <= actIndex || memoryBeat.deadlineAct <= actIndex)) ||
      (keyBeatDeadline !== undefined && keyBeatDeadline <= actIndex)

    if (belongsToClosedAct) {
      blocking.push(foreshadow.id)
    }
  }

  return blocking
}
