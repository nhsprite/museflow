import type { ReducedGraphState } from '../graph/state.js'
import type { StoryMemory } from '../types/story-memory.js'
import type { StoryState } from '../types/story-state.js'
import { applyEvents } from '../story-memory/projector.js'
import { isProjectableForeshadowIntroduction } from '../story-memory/foreshadow-introduction.js'
import { getVerifiedBeatsFromMemory } from '../utils/story-arc.js'
import { getMandatoryBeatEntriesForAct } from '../utils/mandatory-beat-ids.js'

export function cleanOutlineForRewrite(
  outline: ReducedGraphState['outline'],
  targetChapterIndex: number
): ReducedGraphState['outline'] {
  let changed = false
  const next = outline.map((item, index) => {
    if (!item) return item
    const removeStructuredVerification =
      index >= targetChapterIndex && (item.verifiedMandatoryBeatIds?.length ?? 0) > 0
    const removeLegacyVerification = !!item.verifiedBeats || !!item.verifiedBeatEvidence
    if (!removeStructuredVerification && !removeLegacyVerification) return item
    changed = true
    const {
      verifiedBeats: _verifiedBeats,
      verifiedBeatEvidence: _verifiedBeatEvidence,
      verifiedMandatoryBeatIds: _verifiedMandatoryBeatIds,
      ...rest
    } = item
    return {
      ...rest,
      ...(index < targetChapterIndex && item.verifiedMandatoryBeatIds
        ? { verifiedMandatoryBeatIds: item.verifiedMandatoryBeatIds }
        : {}),
    }
  })
  return changed ? next : outline
}

export function cleanStoryMemoryForRewrite(
  memory: StoryMemory,
  targetChapterIndex: number
): StoryMemory {
  const retainedIntroductionIds = new Set(
    memory.events.flatMap((event) =>
      event.type === 'foreshadow-introduce' &&
      event.chapterIndex < targetChapterIndex &&
      isProjectableForeshadowIntroduction(event)
        ? [event.foreshadowId]
        : []
    )
  )
  const filteredEvents = memory.events.filter(
    (event) =>
      event.chapterIndex < targetChapterIndex ||
      (event.type === 'foreshadow-merge' &&
        retainedIntroductionIds.has(event.canonicalForeshadowId) &&
        retainedIntroductionIds.has(event.duplicateForeshadowId))
  )
  if (filteredEvents.length === memory.events.length) {
    return memory
  }
  const truncated: StoryMemory = {
    ...memory,
    events: filteredEvents,
    lastChapterIndex: Math.min(memory.lastChapterIndex, Math.max(0, targetChapterIndex - 1)),
  }
  // applyEvents re-projects from the truncated event log and merges the
  // pre-populated beat metadata (actIndex/description) back in, so beats do not
  // fall back to actIndex 0 the way a bare projectMemory call would.
  return applyEvents(truncated, [])
}

function carryForwardForeshadowMerges(
  memory: StoryMemory,
  authorityMemory: StoryMemory
): StoryMemory {
  const existingEventIds = new Set(memory.events.map((event) => event.id))
  const introducedIds = new Set(
    memory.events.flatMap((event) =>
      event.type === 'foreshadow-introduce' && isProjectableForeshadowIntroduction(event)
        ? [event.foreshadowId]
        : []
    )
  )
  const mergeEvents = authorityMemory.events.filter(
    (event) =>
      event.type === 'foreshadow-merge' &&
      !existingEventIds.has(event.id) &&
      introducedIds.has(event.canonicalForeshadowId) &&
      introducedIds.has(event.duplicateForeshadowId)
  )

  return mergeEvents.length > 0 ? applyEvents(memory, mergeEvents) : memory
}

export function cleanStoryStateForRewrite(
  storyState: StoryState,
  targetChapterIndex: number
): StoryState {
  const canonicalFacts = storyState.canonicalFacts ?? []
  const supersededFacts = storyState.supersededFacts ?? []
  const pendingTasks = storyState.pendingTasks ?? []

  const cleanedCanonicalFacts = canonicalFacts.filter(
    (fact) => fact.source === 'author_override' || fact.establishedIn < targetChapterIndex
  )
  const cleanedSupersededFacts = supersededFacts.filter(
    (fact) => fact.chapterIndex < targetChapterIndex
  )
  // createdChapter is 1-based; chapters >= targetChapterIndex + 1 are rolled back.
  const cleanedPendingTasks = pendingTasks.filter(
    (task) => task.createdChapter <= targetChapterIndex
  )

  if (
    cleanedCanonicalFacts.length === canonicalFacts.length &&
    cleanedSupersededFacts.length === supersededFacts.length &&
    cleanedPendingTasks.length === pendingTasks.length
  ) {
    return storyState
  }

  return {
    ...storyState,
    canonicalFacts: cleanedCanonicalFacts,
    supersededFacts: cleanedSupersededFacts,
    pendingTasks: cleanedPendingTasks,
  }
}

export function recomputeActProgressForRewrite(
  state: Pick<ReducedGraphState, 'storyArc' | 'outline' | 'storyMemory'> &
    Partial<Pick<ReducedGraphState, 'actProgress'>>,
  targetChapterIndex: number
): ReducedGraphState['actProgress'] {
  const storyArc = state.storyArc
  if (!storyArc) return {}

  const verifiedBeatIds = new Set<string>(
    state.storyMemory ? getVerifiedBeatsFromMemory(state.storyMemory, state.storyArc) : []
  )
  for (let index = 0; index < targetChapterIndex; index++) {
    for (const beatId of state.outline[index]?.verifiedMandatoryBeatIds ?? []) {
      verifiedBeatIds.add(beatId)
    }
  }

  const actProgress: ReducedGraphState['actProgress'] = {}
  for (const act of storyArc.acts) {
    const entries = getMandatoryBeatEntriesForAct(act)
    actProgress[act.index] = {
      consumed: entries.filter((entry) => verifiedBeatIds.has(entry.id)).map((entry) => entry.beat),
      pending: entries.filter((entry) => !verifiedBeatIds.has(entry.id)).map((entry) => entry.beat),
    }
  }

  return actProgress
}

/**
 * Single entry point for rewrite state cleanup, shared by the runner (which
 * feeds the result into the graph) and the CLI preview (which only projects it
 * for display). Keeps both paths from drifting apart.
 */
export function applyRewriteCleanup(
  state: ReducedGraphState,
  targetChapterIndex: number,
  authorityState: ReducedGraphState = state
): ReducedGraphState {
  const outline = cleanOutlineForRewrite(state.outline, targetChapterIndex)
  const cleanedStoryMemory = state.storyMemory
    ? cleanStoryMemoryForRewrite(state.storyMemory, targetChapterIndex)
    : state.storyMemory
  const storyMemory =
    cleanedStoryMemory && authorityState.storyMemory
      ? carryForwardForeshadowMerges(cleanedStoryMemory, authorityState.storyMemory)
      : cleanedStoryMemory
  const storyState = state.storyState
    ? cleanStoryStateForRewrite(state.storyState, targetChapterIndex)
    : state.storyState
  // createdAtChapter / fulfilledChapter are 1-based; chapters >= targetChapterIndex + 1
  // are rolled back, so fulfillment markers from those chapters must be reset.
  const foreshadowStack = state.foreshadowStack
    .filter((f) => f.createdAtChapter < targetChapterIndex + 1)
    .map((f) => {
      if (f.fulfilledChapter === undefined || f.fulfilledChapter < targetChapterIndex + 1) {
        return f
      }
      const { fulfilledChapter: _fulfilledChapter, ...rest } = f
      return rest
    })
  // Snapshots are keyed by the structured chapterNumber field (1-based, null for
  // story-level snapshots); drop snapshots of rolled-back chapters.
  const timeline = state.timeline?.filter(
    (snapshot) => snapshot.chapterNumber === null || snapshot.chapterNumber <= targetChapterIndex
  )
  const next: ReducedGraphState = {
    ...state,
    outline,
    storyMemory,
    foreshadowEquivalenceAudit:
      authorityState.foreshadowEquivalenceAudit ?? state.foreshadowEquivalenceAudit,
    storyState,
    foreshadowStack,
    timeline,
  }
  return {
    ...next,
    actProgress: recomputeActProgressForRewrite(next, targetChapterIndex),
  }
}

export function prepareRewritePreviewState(
  state: ReducedGraphState,
  targetChapterIndex: number
): ReducedGraphState {
  return {
    ...applyRewriteCleanup(state, targetChapterIndex),
    currentChapterIndex: targetChapterIndex,
  }
}
