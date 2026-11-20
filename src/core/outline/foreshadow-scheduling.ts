import type { ReducedGraphState } from '../../graph/state.js'
import type { ForeshadowPlanningObligation } from '../../agents/types.js'
import { getChapterPlanningConfig } from '../../utils/chapter-planning.js'
import { getActForChapter } from '../../utils/story-arc.js'
import {
  calculateMinimumForeshadowsToFulfillNow,
  getBoundaryBlockingForeshadowDetails,
  normalizeForeshadowCapacity,
  selectForeshadowsForChapter,
  selectOpportunityForeshadowsForChapter,
  type ScheduledForeshadow,
} from '../../story-memory/foreshadow-policy.js'
import { resolveCanonicalForeshadowId } from '../../story-memory/foreshadow-alias.js'
import type { StoryMemory } from '../../types/story-memory.js'

export interface ForeshadowScheduleContext {
  deadlineCandidateIds: string[]
  opportunityCandidateIds: string[]
  opportunityCandidates: ScheduledForeshadow[]
}

function getLastForeshadowConsideredChapterById(
  memory: StoryMemory,
  outline: ReducedGraphState['outline'],
  chapterIndex: number
): Map<string, number> {
  const lastConsideredChapterById = new Map<string, number>()
  for (let index = 0; index < chapterIndex; index++) {
    const item = outline[index]
    if (!item) continue
    for (const id of [
      ...(item.fulfilledForeshadowIds ?? []),
      ...(item.deferredForeshadowIds ?? []),
    ]) {
      const canonicalId = resolveCanonicalForeshadowId(memory, id) ?? id
      lastConsideredChapterById.set(canonicalId, index + 1)
    }
  }
  return lastConsideredChapterById
}

export function getForeshadowScheduleContext(
  state: ReducedGraphState,
  chapterIndex: number
): ForeshadowScheduleContext {
  const empty = {
    deadlineCandidateIds: [],
    opportunityCandidateIds: [],
    opportunityCandidates: [],
  }
  if (!state.storyMemory) return empty
  const act = getActForChapter(state.storyArc, chapterIndex)
  if (!act) return empty
  const chapterNumber = chapterIndex + 1
  const finalActIndex = state.storyArc?.acts.at(-1)?.index
  const planningConfig = getChapterPlanningConfig(state.genre)
  const deadlineCandidateIds = selectForeshadowsForChapter(
    state.storyMemory,
    chapterNumber,
    planningConfig.foreshadowMaxFulfillmentsPerChapter,
    act.index === finalActIndex
  )
  const opportunityCandidates = selectOpportunityForeshadowsForChapter(state.storyMemory, {
    chapterNumber,
    minFulfillDistance: planningConfig.foreshadowMinFulfillDistance,
    capacity: planningConfig.foreshadowMaxOpportunisticCandidatesPerChapter,
    excludedIds: new Set(deadlineCandidateIds),
    lastConsideredChapterById: getLastForeshadowConsideredChapterById(
      state.storyMemory,
      state.outline,
      chapterIndex
    ),
  })
  return {
    deadlineCandidateIds,
    opportunityCandidateIds: opportunityCandidates.map(({ foreshadow }) => foreshadow.id),
    opportunityCandidates,
  }
}

export function buildForeshadowPlanningObligations(
  state: ReducedGraphState,
  schedule: ForeshadowScheduleContext,
  mustFulfillIds: readonly string[]
): ForeshadowPlanningObligation[] {
  if (!state.storyMemory) return []

  const mustFulfillSet = new Set(mustFulfillIds)
  const mandatory = schedule.deadlineCandidateIds.flatMap((id) => {
    const foreshadow = state.storyMemory?.foreshadows[id]
    if (!foreshadow) return []
    return [
      {
        id: foreshadow.id,
        text: foreshadow.text,
        ...(foreshadow.resolutionQuestion !== undefined
          ? { resolutionQuestion: foreshadow.resolutionQuestion }
          : {}),
        ...(foreshadow.fulfillmentCriteria !== undefined
          ? { fulfillmentCriteria: foreshadow.fulfillmentCriteria }
          : {}),
        kind: foreshadow.kind,
        introducedChapter: foreshadow.introducedIn,
        resolutionPolicy: foreshadow.resolutionPolicy,
        deadlineChapter: foreshadow.expectedFulfillChapter,
        schedulingMode: 'mandatory' as const,
        mustFulfillThisChapter: mustFulfillSet.has(id),
      },
    ]
  })
  const opportunities = schedule.opportunityCandidates.map(({ foreshadow, schedulingMode }) => ({
    id: foreshadow.id,
    text: foreshadow.text,
    ...(foreshadow.resolutionQuestion !== undefined
      ? { resolutionQuestion: foreshadow.resolutionQuestion }
      : {}),
    ...(foreshadow.fulfillmentCriteria !== undefined
      ? { fulfillmentCriteria: foreshadow.fulfillmentCriteria }
      : {}),
    kind: foreshadow.kind,
    introducedChapter: foreshadow.introducedIn,
    resolutionPolicy: foreshadow.resolutionPolicy,
    deadlineChapter: foreshadow.expectedFulfillChapter,
    schedulingMode,
    mustFulfillThisChapter: false,
  }))
  return [...mandatory, ...opportunities]
}

export interface ForeshadowConstraintContext {
  scheduledIds: string[]
  mustFulfillIds: string[]
  remainingChapters: number
  pendingBlockingCount: number
}

export function computeForeshadowConstraintContext(
  state: ReducedGraphState,
  chapterIndex: number,
  scheduledIds: string[]
): ForeshadowConstraintContext {
  const empty = {
    scheduledIds,
    mustFulfillIds: [],
    remainingChapters: 0,
    pendingBlockingCount: 0,
  }
  if (!state.storyArc || !state.storyMemory || scheduledIds.length === 0) return empty

  const currentChapterNumber = chapterIndex + 1
  const act = getActForChapter(state.storyArc, chapterIndex)
  if (!act) return empty

  const remainingChapters = act.endChapter - currentChapterNumber + 1
  const finalActIndex = state.storyArc.acts.at(-1)?.index
  const blockingForeshadows = getBoundaryBlockingForeshadowDetails(
    state.storyMemory,
    act.endChapter,
    act.index === finalActIndex
  )
  const pendingBlockingCount = blockingForeshadows.length
  if (pendingBlockingCount === 0) {
    return { ...empty, remainingChapters, pendingBlockingCount }
  }

  const planningConfig = getChapterPlanningConfig(state.genre)
  const capacity = normalizeForeshadowCapacity(planningConfig.foreshadowMaxFulfillmentsPerChapter)
  const minimumRequiredNow = calculateMinimumForeshadowsToFulfillNow({
    pendingBlockingCount,
    remainingChapters,
    hardCapacity: capacity,
    headroomPerChapter: planningConfig.foreshadowFulfillmentHeadroomPerChapter,
  })
  if (minimumRequiredNow === 0) {
    return { ...empty, remainingChapters, pendingBlockingCount }
  }

  const blockingIds = new Set(blockingForeshadows.map((f) => f.id))
  const mustFulfillIds = scheduledIds
    .filter((id) => blockingIds.has(id))
    .slice(0, minimumRequiredNow)
  return { scheduledIds, mustFulfillIds, remainingChapters, pendingBlockingCount }
}
