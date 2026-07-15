import type { ForeshadowItem } from '../types/foreshadow.js'
import type {
  ForeshadowId,
  ForeshadowMemory,
  StoryEvent,
  StoryMemory,
} from '../types/story-memory.js'
import {
  isProjectableForeshadowIntroduction,
  isValidForeshadowDeadline,
} from './foreshadow-introduction.js'
import { policyFromLegacyStackFields } from './resolution-policy.js'
import { getCanonicalForeshadows } from './foreshadow-alias.js'

export {
  isProjectableForeshadowIntroduction,
  isValidForeshadowDeadline,
} from './foreshadow-introduction.js'

type ForeshadowIntroduceEvent = Extract<StoryEvent, { type: 'foreshadow-introduce' }>

export interface ForeshadowBuckets {
  overdueRequired: ForeshadowItem[]
  dueRequired: ForeshadowItem[]
  normalRequired: ForeshadowItem[]
  optional: ForeshadowItem[]
}

export interface ActiveForeshadowsByPolicy {
  mustResolve: ForeshadowMemory[]
  shouldResolve: ForeshadowMemory[]
  mayRemainOpen: ForeshadowMemory[]
}

export function groupActiveForeshadowsByPolicy(memory: StoryMemory): ActiveForeshadowsByPolicy {
  const groups: ActiveForeshadowsByPolicy = {
    mustResolve: [],
    shouldResolve: [],
    mayRemainOpen: [],
  }

  for (const foreshadow of Object.values(memory.foreshadows)) {
    if (foreshadow.fulfilledIn !== null || foreshadow.waivedIn !== undefined) continue
    switch (foreshadow.resolutionPolicy) {
      case 'must_resolve':
        groups.mustResolve.push(foreshadow)
        break
      case 'should_resolve':
        groups.shouldResolve.push(foreshadow)
        break
      case 'may_remain_open':
        groups.mayRemainOpen.push(foreshadow)
        break
    }
  }

  return groups
}

export function foreshadowMemoryToItem(memory: ForeshadowMemory): ForeshadowItem {
  const item: ForeshadowItem = {
    id: memory.id,
    text: memory.text,
    expectedFulfillChapter: memory.expectedFulfillChapter ?? Number.MAX_SAFE_INTEGER,
    createdAt: 0,
    createdAtChapter: memory.introducedIn + 1,
    status: memory.fulfilledIn !== null ? 'recalled' : 'planted',
    isExplicit: true,
    resolutionPolicy: memory.resolutionPolicy,
    required: memory.required,
  }
  if (memory.kind) item.kind = memory.kind
  if (memory.fulfilledIn !== null) item.fulfilledChapter = memory.fulfilledIn + 1
  if (memory.beatId) item.beatId = memory.beatId
  if (memory.deadlineExtensions !== undefined) {
    item.deadlineExtensions = memory.deadlineExtensions
  }
  return item
}

export function projectForeshadowStack(memory: StoryMemory): ForeshadowItem[] {
  return getCanonicalForeshadows(memory)
    .filter((foreshadow) => foreshadow.waivedIn === undefined)
    .map(foreshadowMemoryToItem)
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

    const resolutionPolicy =
      item.resolutionPolicy ??
      policyFromLegacyStackFields(item.required, item.expectedFulfillChapter)
    if (resolutionPolicy !== 'must_resolve') {
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
    if (event.type === 'foreshadow-introduce' && !isProjectableForeshadowIntroduction(event)) {
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
  return getMandatoryForeshadows(memory).filter(
    (foreshadow) =>
      includeAllRequired ||
      (foreshadow.expectedFulfillChapter !== null &&
        foreshadow.expectedFulfillChapter <= chapterNumber)
  )
}

export function getMandatoryForeshadows(memory: StoryMemory): ForeshadowMemory[] {
  return Object.values(memory.foreshadows)
    .filter(
      (foreshadow) =>
        foreshadow.resolutionPolicy === 'must_resolve' &&
        foreshadow.expectedFulfillChapter !== null &&
        foreshadow.fulfilledIn === null &&
        foreshadow.waivedIn === undefined &&
        isValidForeshadowDeadline(foreshadow.introducedIn, foreshadow.expectedFulfillChapter)
    )
    .sort(compareMandatoryForeshadows)
}

export function selectMandatoryForeshadowsForChapter(
  memory: StoryMemory,
  chapterNumber: number,
  capacity: number,
  includeAllMandatory = false
): ForeshadowMemory[] {
  return getRequiredForeshadowsForScheduling(memory, chapterNumber, includeAllMandatory).slice(
    0,
    normalizeForeshadowCapacity(capacity)
  )
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
  return selectMandatoryForeshadowsForChapter(
    memory,
    chapterNumber,
    capacity,
    includeAllRequired
  ).map((foreshadow) => foreshadow.id)
}

export interface OpportunisticForeshadowSelectionOptions {
  chapterNumber: number
  minFulfillDistance: number
  capacity: number
  excludedIds?: ReadonlySet<ForeshadowId>
  lastConsideredChapterById?: ReadonlyMap<ForeshadowId, number>
}

export type ForeshadowSchedulingMode = 'mandatory' | 'opportunity' | 'ambient'

export interface ScheduledForeshadow {
  foreshadow: ForeshadowMemory
  schedulingMode: ForeshadowSchedulingMode
}

export function selectOpportunityForeshadowsForChapter(
  memory: StoryMemory,
  options: OpportunisticForeshadowSelectionOptions
): ScheduledForeshadow[] {
  const capacity = Number.isFinite(options.capacity) ? Math.max(0, Math.floor(options.capacity)) : 0
  if (capacity === 0) return []

  const minFulfillDistance = Number.isFinite(options.minFulfillDistance)
    ? Math.max(0, Math.floor(options.minFulfillDistance))
    : 0
  const excludedIds = options.excludedIds ?? new Set<ForeshadowId>()
  const lastConsideredChapterById =
    options.lastConsideredChapterById ?? new Map<ForeshadowId, number>()
  const eligible = Object.values(memory.foreshadows).filter(
    (foreshadow) =>
      (foreshadow.resolutionPolicy === 'should_resolve' ||
        foreshadow.resolutionPolicy === 'may_remain_open') &&
      foreshadow.expectedFulfillChapter === null &&
      foreshadow.fulfilledIn === null &&
      foreshadow.waivedIn === undefined &&
      !excludedIds.has(foreshadow.id) &&
      options.chapterNumber >= foreshadow.introducedIn + 1 + minFulfillDistance
  )

  const compareOpportunity = (left: ForeshadowMemory, right: ForeshadowMemory): number => {
    const leftLastConsidered = lastConsideredChapterById.get(left.id) ?? Number.NEGATIVE_INFINITY
    const rightLastConsidered = lastConsideredChapterById.get(right.id) ?? Number.NEGATIVE_INFINITY
    return (
      leftLastConsidered - rightLastConsidered ||
      left.introducedIn - right.introducedIn ||
      compareForeshadowIds(left.id, right.id)
    )
  }

  const shouldResolve = eligible
    .filter((foreshadow) => foreshadow.resolutionPolicy === 'should_resolve')
    .sort(compareOpportunity)
  const ambient = eligible
    .filter((foreshadow) => foreshadow.resolutionPolicy === 'may_remain_open')
    .sort(compareOpportunity)

  return [
    ...shouldResolve.map((foreshadow) => ({
      foreshadow,
      schedulingMode: 'opportunity' as const,
    })),
    ...ambient.map((foreshadow) => ({
      foreshadow,
      schedulingMode: 'ambient' as const,
    })),
  ].slice(0, capacity)
}

export function selectOpportunisticForeshadowsForChapter(
  memory: StoryMemory,
  options: OpportunisticForeshadowSelectionOptions
): ForeshadowId[] {
  return selectOpportunityForeshadowsForChapter(memory, options).map(
    ({ foreshadow }) => foreshadow.id
  )
}

function compareMandatoryForeshadows(left: ForeshadowMemory, right: ForeshadowMemory): number {
  return (
    (left.expectedFulfillChapter ?? 0) - (right.expectedFulfillChapter ?? 0) ||
    left.introducedIn - right.introducedIn ||
    compareForeshadowIds(left.id, right.id)
  )
}

function compareForeshadowIds(left: ForeshadowId, right: ForeshadowId): number {
  return left < right ? -1 : left > right ? 1 : 0
}
