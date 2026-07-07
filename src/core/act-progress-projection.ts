import type { ReducedGraphState } from '../graph/state.js'
import { getVerifiedBeatsFromMemory } from '../utils/story-arc.js'
import { findClaimedMandatoryBeatForId } from '../utils/mandatory-beat-mapping.js'

export function projectVerifiedClaimedBeatIdsIntoActProgress(
  state: Pick<
    ReducedGraphState,
    'actProgress' | 'currentChapterIndex' | 'outline' | 'storyArc' | 'storyMemory'
  >
): ReducedGraphState['actProgress'] {
  const projected: ReducedGraphState['actProgress'] = {}
  for (const [actIndex, progress] of Object.entries(state.actProgress ?? {})) {
    projected[Number(actIndex)] = {
      consumed: [...progress.consumed],
      pending: [...progress.pending],
    }
  }

  if (!state.storyArc || !state.storyMemory) {
    return projected
  }

  const throughChapterIndex = state.currentChapterIndex - 1
  if (throughChapterIndex < 0) {
    return projected
  }

  for (const beatId of getVerifiedBeatsFromMemory(state.storyMemory)) {
    const claimedIn = state.storyMemory.beats[beatId]?.claimedIn
    const options =
      typeof claimedIn === 'number'
        ? { preferredChapterIndex: claimedIn, throughChapterIndex }
        : { throughChapterIndex }
    const claimedMandatoryBeat = findClaimedMandatoryBeatForId(
      state.outline,
      state.storyArc,
      beatId,
      options
    )
    if (!claimedMandatoryBeat) continue

    const act = state.storyArc.acts.find((candidate) =>
      candidate.mandatoryBeats.includes(claimedMandatoryBeat)
    )
    if (!act) continue

    const progress = projected[act.index] ?? {
      consumed: [],
      pending: [...act.mandatoryBeats],
    }
    if (!progress.consumed.includes(claimedMandatoryBeat)) {
      progress.consumed = [...progress.consumed, claimedMandatoryBeat]
    }
    progress.pending = progress.pending.filter((beat) => beat !== claimedMandatoryBeat)
    projected[act.index] = progress
  }

  return projected
}
