import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../../graph/state.js'
import type { ChapterPlan } from '../../agents/types.js'
import {
  areForeshadowFulfillmentEventsStructurallyCompatible,
  findForeshadowFulfillmentConflictIds,
  resolveCanonicalForeshadowId,
} from '../../story-memory/foreshadow-alias.js'
import type {
  ForeshadowFulfillEvent,
  ForeshadowId,
  StoryEvent,
  StoryMemory,
} from '../../types/story-memory.js'

export function canonicalizeForeshadowClaimIds(
  memory: StoryMemory,
  ids: readonly ForeshadowId[]
): ForeshadowId[] {
  const canonicalIds: ForeshadowId[] = []
  const seen = new Set<ForeshadowId>()

  for (const id of ids) {
    const canonicalId = resolveCanonicalForeshadowId(memory, id) ?? id
    if (seen.has(canonicalId)) continue
    seen.add(canonicalId)
    canonicalIds.push(canonicalId)
  }

  return canonicalIds
}

interface ForeshadowClaimOutline {
  fulfilledForeshadowIds?: ForeshadowId[]
  deferredForeshadowIds?: ForeshadowId[]
}

export function getConflictingForeshadowDecisionIds(
  outline: ForeshadowClaimOutline
): ForeshadowId[] {
  const deferredIds = new Set(outline.deferredForeshadowIds ?? [])
  const seen = new Set<ForeshadowId>()
  const conflictingIds: ForeshadowId[] = []

  for (const id of outline.fulfilledForeshadowIds ?? []) {
    if (!deferredIds.has(id) || seen.has(id)) continue
    seen.add(id)
    conflictingIds.push(id)
  }

  return conflictingIds
}

interface CanonicalizedForeshadowPlan {
  plan: ChapterPlan
  conflictingEventIds: ForeshadowId[]
}

function canonicalizePlanForeshadowClaims(
  memory: StoryMemory,
  plan: ChapterPlan
): CanonicalizedForeshadowPlan {
  const expectedEvents: StoryEvent[] = []
  const firstEventByCanonicalId = new Map<ForeshadowId, ForeshadowFulfillEvent>()
  const conflictingEventIds = new Set<ForeshadowId>(
    canonicalizeForeshadowClaimIds(memory, plan.foreshadowFulfillmentConflictIds ?? [])
  )

  for (const event of plan.expectedEvents ?? []) {
    if (event.type !== 'foreshadow-fulfill') {
      expectedEvents.push(event)
      continue
    }

    const canonicalId = resolveCanonicalForeshadowId(memory, event.foreshadowId)
    if (canonicalId === null) {
      expectedEvents.push(event)
      continue
    }

    const canonicalEvent = { ...event, foreshadowId: canonicalId }
    const firstEvent = firstEventByCanonicalId.get(canonicalId)
    if (!firstEvent) {
      firstEventByCanonicalId.set(canonicalId, canonicalEvent)
      expectedEvents.push(canonicalEvent)
      continue
    }
    if (areForeshadowFulfillmentEventsStructurallyCompatible(firstEvent, canonicalEvent)) continue

    conflictingEventIds.add(canonicalId)
    expectedEvents.push(canonicalEvent)
  }

  return {
    plan: {
      ...plan,
      fulfilledForeshadowIds: canonicalizeForeshadowClaimIds(
        memory,
        plan.fulfilledForeshadowIds ?? []
      ),
      expectedEvents,
    },
    conflictingEventIds: Array.from(conflictingEventIds),
  }
}

export function canonicalizeChapterForeshadowClaims<T extends ForeshadowClaimOutline>(
  memory: StoryMemory,
  outline: T,
  plan: ChapterPlan | null
): {
  outline: T
  plan: ChapterPlan | null
  conflictingEventIds: ForeshadowId[]
  conflictingDecisionIds: ForeshadowId[]
} {
  const canonicalOutline = {
    ...outline,
    ...(outline.fulfilledForeshadowIds
      ? {
          fulfilledForeshadowIds: canonicalizeForeshadowClaimIds(
            memory,
            outline.fulfilledForeshadowIds
          ),
        }
      : {}),
    ...(outline.deferredForeshadowIds
      ? {
          deferredForeshadowIds: canonicalizeForeshadowClaimIds(
            memory,
            outline.deferredForeshadowIds
          ),
        }
      : {}),
  }

  const canonicalPlan = plan ? canonicalizePlanForeshadowClaims(memory, plan) : null
  return {
    outline: canonicalOutline,
    plan: canonicalPlan?.plan ?? null,
    conflictingEventIds: canonicalPlan?.conflictingEventIds ?? [],
    conflictingDecisionIds: getConflictingForeshadowDecisionIds(canonicalOutline),
  }
}

export function canonicalizeStateForeshadowClaims(
  state: ReducedGraphState,
  chapterIndex: number
): ReducedGraphState {
  const memory = state.storyMemory
  const outlineItem = state.outline[chapterIndex]
  if (!memory || !outlineItem) return state

  const canonical = canonicalizeChapterForeshadowClaims(memory, outlineItem, null)
  const outline = [...state.outline]
  outline[chapterIndex] = canonical.outline
  return { ...state, outline }
}

export function deferForeshadowClaims(
  state: ReducedGraphState,
  chapterIndex: number,
  plan: ChapterPlan,
  ids: readonly string[]
): { state: ReducedGraphState; plan: ChapterPlan } {
  const deferredIds = new Set(ids)
  const outline = [...state.outline]
  const item = outline[chapterIndex]
  if (!item) return { state, plan }

  outline[chapterIndex] = {
    ...item,
    fulfilledForeshadowIds: (item.fulfilledForeshadowIds ?? []).filter(
      (id) => !deferredIds.has(id)
    ),
    deferredForeshadowIds: Array.from(
      new Set([...(item.deferredForeshadowIds ?? []), ...deferredIds])
    ),
  }

  const { foreshadowFulfillmentConflictIds: _conflictIds, ...deferredPlan } = plan
  const remainingConflictIds = (plan.foreshadowFulfillmentConflictIds ?? []).filter(
    (id) => !deferredIds.has(id)
  )

  return {
    state: { ...state, outline },
    plan: {
      ...deferredPlan,
      ...(remainingConflictIds.length > 0
        ? { foreshadowFulfillmentConflictIds: remainingConflictIds }
        : {}),
      fulfilledForeshadowIds: plan.fulfilledForeshadowIds.filter((id) => !deferredIds.has(id)),
      expectedEvents: plan.expectedEvents.filter(
        (event) => event.type !== 'foreshadow-fulfill' || !deferredIds.has(event.foreshadowId)
      ),
    },
  }
}

export interface ScheduledForeshadowPlanEvidence {
  declarationIds: string[]
  eventIds: string[]
  forbiddenFulfillmentIds: string[]
}

export interface ScheduledForeshadowPlanEvaluation {
  missing: ScheduledForeshadowPlanEvidence
  plan: ChapterPlan
}

export function getMissingScheduledForeshadowIds(
  fulfilledForeshadowIds: string[] | undefined,
  scheduledForeshadowIds: string[]
): string[] {
  const fulfilled = new Set(fulfilledForeshadowIds ?? [])
  return scheduledForeshadowIds.filter((id) => !fulfilled.has(id))
}

/** 以大纲裁决为基准，校验章节规划中的伏笔声明和兑现事件。 */
export function evaluateScheduledForeshadowPlanEvidence(
  chapterPlan: ChapterPlan,
  outlineFulfilledForeshadowIds: string[],
  outlineDeferredForeshadowIds: string[],
  requestedChapterIndex: number,
  memory: StoryMemory | null | undefined
): ScheduledForeshadowPlanEvaluation {
  const canonicalized = memory
    ? canonicalizeChapterForeshadowClaims(
        memory,
        {
          fulfilledForeshadowIds: outlineFulfilledForeshadowIds,
          deferredForeshadowIds: outlineDeferredForeshadowIds,
        },
        chapterPlan
      )
    : {
        outline: {
          fulfilledForeshadowIds: outlineFulfilledForeshadowIds,
          deferredForeshadowIds: outlineDeferredForeshadowIds,
        },
        plan: chapterPlan,
        conflictingEventIds: Array.from(
          new Set([
            ...(chapterPlan.foreshadowFulfillmentConflictIds ?? []),
            ...findForeshadowFulfillmentConflictIds(undefined, chapterPlan.expectedEvents ?? []),
          ])
        ),
        conflictingDecisionIds: getConflictingForeshadowDecisionIds({
          fulfilledForeshadowIds: outlineFulfilledForeshadowIds,
          deferredForeshadowIds: outlineDeferredForeshadowIds,
        }),
      }
  const canonicalPlan = canonicalized.plan ?? chapterPlan
  const canonicalOutlineFulfilledIds = canonicalized.outline.fulfilledForeshadowIds ?? []
  const canonicalOutlineDeferredIds = new Set(canonicalized.outline.deferredForeshadowIds ?? [])
  const declarationIds = getMissingScheduledForeshadowIds(
    canonicalPlan.fulfilledForeshadowIds,
    canonicalOutlineFulfilledIds
  )
  const eventForeshadowIds = new Set<string>()
  for (const event of canonicalPlan.expectedEvents ?? []) {
    if (event.type === 'foreshadow-fulfill' && event.chapterIndex === requestedChapterIndex) {
      eventForeshadowIds.add(event.foreshadowId)
    }
  }
  const forbiddenFulfillmentIds = new Set<string>()
  for (const id of canonicalPlan.fulfilledForeshadowIds ?? []) {
    if (canonicalOutlineDeferredIds.has(id)) forbiddenFulfillmentIds.add(id)
  }
  for (const event of canonicalPlan.expectedEvents ?? []) {
    if (
      event.type === 'foreshadow-fulfill' &&
      canonicalOutlineDeferredIds.has(event.foreshadowId)
    ) {
      forbiddenFulfillmentIds.add(event.foreshadowId)
    }
  }
  const missing = {
    declarationIds,
    eventIds: Array.from(
      new Set([
        ...canonicalOutlineFulfilledIds.filter((id) => !eventForeshadowIds.has(id)),
        ...canonicalized.conflictingEventIds,
      ])
    ),
    forbiddenFulfillmentIds: Array.from(forbiddenFulfillmentIds),
  }
  return { missing, plan: { ...canonicalPlan, chapterIndex: requestedChapterIndex } }
}

export function hasMissingScheduledForeshadowPlanEvidence(
  missing: ScheduledForeshadowPlanEvidence
): boolean {
  return (
    missing.declarationIds.length > 0 ||
    missing.eventIds.length > 0 ||
    missing.forbiddenFulfillmentIds.length > 0
  )
}

export function formatMissingScheduledForeshadowPlanEvidence(
  missing: ScheduledForeshadowPlanEvidence
): string {
  return [
    `fulfilledForeshadowIds：${missing.declarationIds.join(', ') || '（无遗漏）'}`,
    `expectedEvents.foreshadow-fulfill：${missing.eventIds.join(', ') || '（无遗漏）'}`,
    ...(missing.forbiddenFulfillmentIds.length > 0
      ? [`禁止兑现：${missing.forbiddenFulfillmentIds.join(', ')}`]
      : []),
  ].join('；')
}

function formatScheduledForeshadowPlanDiagnostic(
  missing: ScheduledForeshadowPlanEvidence,
  capacity: number
): string {
  return `${formatMissingScheduledForeshadowPlanEvidence(missing)}（单章容量 ${capacity}）`
}

export function logScheduledForeshadowPlanAttempt(
  chapterIndex: number,
  stage: string,
  attempt: number,
  maxAttempts: number,
  missing: ScheduledForeshadowPlanEvidence,
  capacity: number,
  informational = false
): void {
  const message = `[MuseFlow] 第 ${chapterIndex + 1} 章${stage}第 ${attempt}/${maxAttempts} 次遗漏大纲声称的伏笔兑现证据：${formatScheduledForeshadowPlanDiagnostic(missing, capacity)}`
  if (informational) {
    logger.info(message)
  } else {
    logger.warn(message)
  }
}

export function getMissingForeshadowPlanEvidenceIds(
  missing: ScheduledForeshadowPlanEvidence
): string[] {
  return Array.from(
    new Set([...missing.declarationIds, ...missing.eventIds, ...missing.forbiddenFulfillmentIds])
  )
}

export function buildScheduledForeshadowPlanError(
  chapterIndex: number,
  stage: string,
  missing: ScheduledForeshadowPlanEvidence,
  capacity: number
): Error {
  return new Error(
    `第 ${chapterIndex + 1} 章${stage}遗漏大纲声称的伏笔兑现证据：${formatScheduledForeshadowPlanDiagnostic(missing, capacity)}`
  )
}
