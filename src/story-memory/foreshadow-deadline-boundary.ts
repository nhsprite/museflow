import type { StoryArc } from '../types/outline.js'
import type { ForeshadowPolicySetEvent, StoryMemory } from '../types/story-memory.js'
import { isValidForeshadowDeadline } from './foreshadow-policy.js'

export interface StoryBoundarySources {
  runtimeTotalChapters: number
  storyTotalChapters: number
  storyArc: StoryArc | null | undefined
}

function isValidBoundaryChapter(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 1
}

/**
 * Resolve the authoritative current story boundary without discarding an act
 * extension that has already been persisted in one projection but not another.
 */
export function resolveStoryBoundaryChapter(sources: StoryBoundarySources): number {
  const candidates = [
    sources.runtimeTotalChapters,
    sources.storyTotalChapters,
    sources.storyArc?.totalChapters,
    ...(sources.storyArc?.acts.map((act) => act.endChapter) ?? []),
  ].filter(isValidBoundaryChapter)

  return candidates.length > 0 ? Math.max(...candidates) : 1
}

export function clampForeshadowDeadlineToBoundary(
  proposedDeadline: number,
  boundaryChapter: number
): number {
  return Math.min(proposedDeadline, boundaryChapter)
}

/**
 * Convert persisted out-of-range must-resolve deadlines into event-sourced
 * policy corrections. Replaying the returned events makes a second call a
 * no-op, so checkpoint normalization remains idempotent.
 */
export function buildForeshadowDeadlineBoundaryCorrectionEvents(
  memory: StoryMemory,
  boundaryChapter: number,
  chapterIndex: number
): ForeshadowPolicySetEvent[] {
  if (!isValidBoundaryChapter(boundaryChapter)) return []

  return Object.values(memory.foreshadows)
    .filter(
      (foreshadow) =>
        foreshadow.resolutionPolicy === 'must_resolve' &&
        foreshadow.fulfilledIn === null &&
        foreshadow.waivedIn === undefined &&
        foreshadow.expectedFulfillChapter !== null &&
        foreshadow.expectedFulfillChapter > boundaryChapter &&
        isValidForeshadowDeadline(foreshadow.introducedIn, boundaryChapter)
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((foreshadow) => ({
      id: `evt-foreshadow-boundary-${boundaryChapter}-${foreshadow.id}-${memory.events.length}`,
      type: 'foreshadow-policy-set',
      foreshadowId: foreshadow.id,
      resolutionPolicy: 'must_resolve',
      expectedFulfillChapter: boundaryChapter,
      chapterIndex,
      source: 'outline',
    }))
}
