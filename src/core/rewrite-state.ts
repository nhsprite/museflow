import type { ReducedGraphState } from '../graph/state.js'
import type { StoryMemory } from '../types/story-memory.js'
import { projectMemory } from '../story-memory/projector.js'
import { getVerifiedBeatsFromMemory } from '../utils/story-arc.js'
import { findClaimedMandatoryBeatForId } from '../utils/mandatory-beat-mapping.js'

export function cleanOutlineForRewrite(
  outline: ReducedGraphState['outline'],
  targetChapterIndex: number
): ReducedGraphState['outline'] {
  let changed = false
  const next = outline.map((item, index) => {
    if (index < targetChapterIndex || (!item?.verifiedBeats && !item?.verifiedBeatEvidence)) {
      return item
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
  return projectMemory({
    ...memory,
    events: filteredEvents,
    lastChapterIndex: Math.min(memory.lastChapterIndex, Math.max(0, targetChapterIndex - 1)),
  })
}

export function recomputeActProgressForRewrite(
  state: Pick<ReducedGraphState, 'storyArc' | 'outline' | 'storyMemory'>,
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
    const verifiedBeats = state.outline[index]?.verifiedBeats ?? []
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
      addIfMandatory(findClaimedMandatoryBeatForId(state.outline, storyArc, beatId, options))
      addIfMandatory(keyBeatTextById.get(beatId) ?? beatId)
    }

    actProgress[act.index] = {
      consumed,
      pending: act.mandatoryBeats.filter((beat) => !consumed.includes(beat)),
    }
  }

  return actProgress
}

export function prepareRewritePreviewState(
  state: ReducedGraphState,
  targetChapterIndex: number
): ReducedGraphState {
  const outline = cleanOutlineForRewrite(state.outline, targetChapterIndex)
  const storyMemory = state.storyMemory
    ? cleanStoryMemoryForRewrite(state.storyMemory, targetChapterIndex)
    : state.storyMemory
  const next = {
    ...state,
    currentChapterIndex: targetChapterIndex,
    outline,
    storyMemory,
    chapterSummaries: state.chapterSummaries.slice(0, targetChapterIndex),
    foreshadowStack: state.foreshadowStack.filter(
      (f) => f.createdAtChapter < targetChapterIndex + 1
    ),
  }
  return {
    ...next,
    actProgress: recomputeActProgressForRewrite(next, targetChapterIndex),
  }
}
