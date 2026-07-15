import type { ModelProvider } from '../../../model/provider.js'
import type {
  ForeshadowId,
  ForeshadowMergeEvent,
  StoryEvent,
  StoryMemory,
} from '../../../types/story-memory.js'
import { generateId } from '../../../utils/id.js'
import {
  FORESHADOW_EQUIVALENCE_AUDIT_PROTOCOL_VERSION,
  type ForeshadowEquivalenceAudit,
} from '../../state.js'
import {
  compareCanonicalOrder,
  ForeshadowMergeValidationError,
  getCanonicalForeshadows,
  resolveCanonicalForeshadowId,
} from '../../../story-memory/foreshadow-alias.js'
import { applyEvents } from '../../../story-memory/projector.js'
import {
  detectForeshadowEquivalence,
  ForeshadowEquivalenceError,
  type ForeshadowEquivalenceGroup,
} from './detector.js'

export async function reconcileForeshadowEquivalence(input: {
  provider: ModelProvider
  memory: StoryMemory
  chapterIndex: number
  audit?: ForeshadowEquivalenceAudit
  proposedEvents?: readonly StoryEvent[]
}): Promise<{
  memory: StoryMemory
  audit: ForeshadowEquivalenceAudit
  mergeEvents: ForeshadowMergeEvent[]
}> {
  const proposedEvents = [...(input.proposedEvents ?? [])]
  const candidateMemory = applyEventsWithMergeValidation(input.memory, proposedEvents)
  const activeCanonicalIds = collectActiveCanonicalIds(candidateMemory)
  const proposedIntroduceEvents = proposedEvents.filter(
    (event): event is Extract<StoryEvent, { type: 'foreshadow-introduce' }> =>
      event.type === 'foreshadow-introduce'
  )

  if (proposedIntroduceEvents.length === 0 && auditMatches(input.audit, activeCanonicalIds)) {
    return {
      memory: candidateMemory,
      audit: createAudit(activeCanonicalIds),
      mergeEvents: [],
    }
  }

  const candidateIds = new Set<ForeshadowId>(activeCanonicalIds)
  for (const event of proposedIntroduceEvents) {
    const canonicalId = resolveCanonicalForeshadowId(candidateMemory, event.foreshadowId)
    if (canonicalId !== null) candidateIds.add(canonicalId)
  }
  const orderedCandidateIds = Array.from(candidateIds).sort((left, right) =>
    compareCanonicalOrder(candidateMemory, left, right)
  )

  if (orderedCandidateIds.length <= 1) {
    return {
      memory: candidateMemory,
      audit: createAudit(activeCanonicalIds),
      mergeEvents: [],
    }
  }

  const groups = await detectForeshadowEquivalence({
    provider: input.provider,
    candidates: orderedCandidateIds.map((id) => {
      const foreshadow = candidateMemory.foreshadows[id]!
      return {
        id: foreshadow.id,
        text: foreshadow.text,
        kind: foreshadow.kind,
        introducedChapter: foreshadow.introducedIn + 1,
      }
    }),
  })
  const mergeEvents = buildMergeEvents(candidateMemory, input.chapterIndex, groups)
  const reconciledMemory = applyEventsWithMergeValidation(candidateMemory, mergeEvents)

  return {
    memory: reconciledMemory,
    audit: createAudit(collectActiveCanonicalIds(reconciledMemory)),
    mergeEvents,
  }
}

function applyEventsWithMergeValidation(memory: StoryMemory, events: StoryEvent[]): StoryMemory {
  if (events.length === 0) return memory
  try {
    return applyEvents(memory, events)
  } catch (error) {
    if (error instanceof ForeshadowMergeValidationError) {
      throw new ForeshadowEquivalenceError('Foreshadow equivalence merge validation failed', {
        cause: error,
      })
    }
    throw error
  }
}

function collectActiveCanonicalIds(memory: StoryMemory): ForeshadowId[] {
  return getCanonicalForeshadows(memory)
    .filter((foreshadow) => foreshadow.fulfilledIn === null && foreshadow.waivedIn === undefined)
    .map((foreshadow) => foreshadow.id)
}

function createAudit(activeCanonicalIds: ForeshadowId[]): ForeshadowEquivalenceAudit {
  return {
    protocolVersion: FORESHADOW_EQUIVALENCE_AUDIT_PROTOCOL_VERSION,
    activeCanonicalIds: [...activeCanonicalIds],
  }
}

function auditMatches(
  audit: ForeshadowEquivalenceAudit | undefined,
  activeCanonicalIds: readonly ForeshadowId[]
): boolean {
  return (
    audit?.protocolVersion === FORESHADOW_EQUIVALENCE_AUDIT_PROTOCOL_VERSION &&
    audit.activeCanonicalIds.length === activeCanonicalIds.length &&
    audit.activeCanonicalIds.every((id, index) => id === activeCanonicalIds[index])
  )
}

function buildMergeEvents(
  memory: StoryMemory,
  chapterIndex: number,
  groups: readonly ForeshadowEquivalenceGroup[]
): ForeshadowMergeEvent[] {
  const normalizedGroups = groups
    .map((group) => ({
      reason: group.reason,
      ids: [...group.ids].sort((left, right) => compareCanonicalOrder(memory, left, right)),
    }))
    .sort((left, right) => compareIdLists(memory, left.ids, right.ids))

  return normalizedGroups
    .flatMap((group) => {
      const canonicalForeshadowId = group.ids[0]
      if (canonicalForeshadowId === undefined) return []
      return group.ids.slice(1).map((duplicateForeshadowId) => ({
        canonicalForeshadowId,
        duplicateForeshadowId,
        reason: group.reason,
      }))
    })
    .sort(
      (left, right) =>
        compareCanonicalOrder(memory, left.canonicalForeshadowId, right.canonicalForeshadowId) ||
        compareCanonicalOrder(memory, left.duplicateForeshadowId, right.duplicateForeshadowId) ||
        left.canonicalForeshadowId.localeCompare(right.canonicalForeshadowId) ||
        left.duplicateForeshadowId.localeCompare(right.duplicateForeshadowId)
    )
    .map((edge) => ({
      id: generateId('evt'),
      type: 'foreshadow-merge',
      source: 'outline',
      chapterIndex,
      ...edge,
    }))
}

function compareIdLists(
  memory: StoryMemory,
  left: readonly ForeshadowId[],
  right: readonly ForeshadowId[]
): number {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftId = left[index]!
    const rightId = right[index]!
    const order = compareCanonicalOrder(memory, leftId, rightId) || leftId.localeCompare(rightId)
    if (order !== 0) return order
  }
  return left.length - right.length
}
