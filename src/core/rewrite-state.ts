import type { ReducedGraphState } from '../graph/state.js'
import type { StoryMemory } from '../types/story-memory.js'
import type { StoryState } from '../types/story-state.js'
import { applyEvents } from '../story-memory/projector.js'
import { getVerifiedBeatsFromMemory } from '../utils/story-arc.js'
import {
  findClaimedMandatoryBeatForId,
  getClaimedMandatoryBeatForId,
} from '../utils/mandatory-beat-mapping.js'
import { findMandatoryBeatById } from '../utils/mandatory-beat-ids.js'

export function cleanOutlineForRewrite(
  outline: ReducedGraphState['outline'],
  targetChapterIndex: number,
  storyArc?: ReducedGraphState['storyArc']
): ReducedGraphState['outline'] {
  let changed = false
  const next = outline.map((item, index) => {
    if (!item?.verifiedBeats && !item?.verifiedBeatEvidence) {
      return item
    }

    if (index < targetChapterIndex) {
      if (!storyArc) return item
      const trustedVerifiedBeats = getTrustedOutlineVerifiedBeatsForRewrite(item, storyArc)
      const trustedSet = new Set(trustedVerifiedBeats)
      const trustedEvidence = item.verifiedBeatEvidence?.filter((evidence) =>
        trustedSet.has(evidence.beat)
      )
      const currentVerifiedBeats = item.verifiedBeats ?? []
      const currentEvidence = item.verifiedBeatEvidence ?? []
      const sameVerifiedBeats =
        trustedVerifiedBeats.length === currentVerifiedBeats.length &&
        trustedVerifiedBeats.every((beat, beatIndex) => beat === currentVerifiedBeats[beatIndex])
      const sameEvidence =
        !item.verifiedBeatEvidence || trustedEvidence?.length === currentEvidence.length
      if (sameVerifiedBeats && sameEvidence) {
        return item
      }
      changed = true
      const {
        verifiedBeats: _verifiedBeats,
        verifiedBeatEvidence: _verifiedBeatEvidence,
        ...rest
      } = item
      return {
        ...rest,
        ...(trustedVerifiedBeats.length > 0 ? { verifiedBeats: trustedVerifiedBeats } : {}),
        ...(trustedEvidence && trustedEvidence.length > 0
          ? { verifiedBeatEvidence: trustedEvidence }
          : {}),
      }
    }

    changed = true
    const {
      verifiedBeats: _verifiedBeats,
      verifiedBeatEvidence: _verifiedBeatEvidence,
      ...rest
    } = item
    return rest
  })
  return changed ? next : outline
}

export function cleanStoryMemoryForRewrite(
  memory: StoryMemory,
  targetChapterIndex: number
): StoryMemory {
  const filteredEvents = memory.events.filter((event) => event.chapterIndex < targetChapterIndex)
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

function getTrustedOutlineVerifiedBeatsForRewrite(
  outlineItem: ReducedGraphState['outline'][number] | undefined,
  storyArc: NonNullable<ReducedGraphState['storyArc']>
): string[] {
  if (!outlineItem?.verifiedBeats && !outlineItem?.verifiedMandatoryBeatIds) return []

  const claimedBeats = outlineItem.claimedBeats ?? []
  const claimedBeatIds = outlineItem.claimedBeatIds ?? []
  const claimedMandatoryBeatIds = outlineItem.claimedMandatoryBeatIds ?? []
  const verifiedMandatoryBeats = (outlineItem.verifiedMandatoryBeatIds ?? [])
    .map((beatId) => findMandatoryBeatById(storyArc, beatId)?.beat)
    .filter((beat): beat is string => !!beat)
  if (
    claimedBeats.length === 0 &&
    claimedBeatIds.length === 0 &&
    claimedMandatoryBeatIds.length === 0
  ) {
    const trusted: string[] = []
    for (const beat of [...(outlineItem.verifiedBeats ?? []), ...verifiedMandatoryBeats]) {
      if (!trusted.includes(beat)) {
        trusted.push(beat)
      }
    }
    return trusted
  }

  const trustedCandidates = new Set<string>()

  for (const beat of verifiedMandatoryBeats) {
    trustedCandidates.add(beat)
  }

  for (const beat of claimedBeats) {
    trustedCandidates.add(beat)
  }

  for (const beatId of claimedMandatoryBeatIds) {
    const mandatoryBeat = findMandatoryBeatById(storyArc, beatId)?.beat
    if (mandatoryBeat) {
      trustedCandidates.add(mandatoryBeat)
    }
  }

  for (const beatId of claimedBeatIds) {
    const claimedMandatoryBeat = getClaimedMandatoryBeatForId(outlineItem, storyArc, beatId)
    if (claimedMandatoryBeat) {
      trustedCandidates.add(claimedMandatoryBeat)
    }

    const keyBeat = storyArc.keyBeats.find((beat) => beat.id === beatId)
    if (keyBeat) {
      trustedCandidates.add(keyBeat.beat)
    }
  }

  const trusted: string[] = []
  for (const beat of [...(outlineItem.verifiedBeats ?? []), ...verifiedMandatoryBeats]) {
    if (trustedCandidates.has(beat) && !trusted.includes(beat)) {
      trusted.push(beat)
    }
  }

  return trusted
}

export function recomputeActProgressForRewrite(
  state: Pick<ReducedGraphState, 'storyArc' | 'outline' | 'storyMemory'> &
    Partial<Pick<ReducedGraphState, 'actProgress'>>,
  targetChapterIndex: number
): ReducedGraphState['actProgress'] {
  const storyArc = state.storyArc
  if (!storyArc) return {}

  const verifiedBeatIds = new Set(
    state.storyMemory ? getVerifiedBeatsFromMemory(state.storyMemory) : []
  )
  const keyBeatTextById = new Map(storyArc.keyBeats.map((beat) => [beat.id, beat.beat] as const))

  const outlineVerifiedBeats = new Set<string>()
  for (let index = 0; index < targetChapterIndex; index++) {
    const verifiedBeats = getTrustedOutlineVerifiedBeatsForRewrite(state.outline[index], storyArc)
    for (const beat of verifiedBeats) {
      outlineVerifiedBeats.add(beat)
    }
  }

  const actProgress: ReducedGraphState['actProgress'] = {}
  for (const act of storyArc.acts) {
    const consumed: string[] = []
    const addIfMandatory = (beat: string | undefined) => {
      if (beat && act.mandatoryBeats.includes(beat) && !consumed.includes(beat)) {
        consumed.push(beat)
      }
    }

    for (const beat of act.mandatoryBeats) {
      if (outlineVerifiedBeats.has(beat)) {
        addIfMandatory(beat)
      }
    }

    for (const beatId of verifiedBeatIds) {
      const claimedIn = state.storyMemory?.beats[beatId]?.claimedIn
      const options =
        typeof claimedIn === 'number'
          ? { preferredChapterIndex: claimedIn, throughChapterIndex: targetChapterIndex - 1 }
          : { throughChapterIndex: targetChapterIndex - 1 }
      addIfMandatory(findMandatoryBeatById(storyArc, beatId)?.beat)
      addIfMandatory(findClaimedMandatoryBeatForId(state.outline, storyArc, beatId, options))
      addIfMandatory(keyBeatTextById.get(beatId) ?? beatId)
    }

    if (act.endChapter <= targetChapterIndex) {
      const existing = state.actProgress?.[act.index]
      for (const beat of existing?.consumed ?? []) {
        addIfMandatory(beat)
      }
    }

    actProgress[act.index] = {
      consumed,
      pending: act.mandatoryBeats.filter((beat) => !consumed.includes(beat)),
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
  targetChapterIndex: number
): ReducedGraphState {
  const outline = cleanOutlineForRewrite(state.outline, targetChapterIndex, state.storyArc)
  const storyMemory = state.storyMemory
    ? cleanStoryMemoryForRewrite(state.storyMemory, targetChapterIndex)
    : state.storyMemory
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
