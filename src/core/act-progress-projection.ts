import type { ReducedGraphState } from '../graph/state.js'
import { getVerifiedBeatsFromMemory } from '../utils/story-arc.js'
import { getMandatoryBeatEntriesForAct } from '../utils/mandatory-beat-ids.js'

export function projectVerifiedClaimedBeatIdsIntoActProgress(
  state: Pick<ReducedGraphState, 'storyArc' | 'storyMemory'>
): ReducedGraphState['actProgress'] {
  if (!state.storyArc) return {}

  const verifiedBeatIds = new Set(
    state.storyMemory ? getVerifiedBeatsFromMemory(state.storyMemory, state.storyArc) : []
  )
  const projected: ReducedGraphState['actProgress'] = {}
  for (const act of state.storyArc.acts) {
    const entries = getMandatoryBeatEntriesForAct(act)
    projected[act.index] = {
      consumed: entries.filter((entry) => verifiedBeatIds.has(entry.id)).map((entry) => entry.beat),
      pending: entries.filter((entry) => !verifiedBeatIds.has(entry.id)).map((entry) => entry.beat),
    }
  }

  return projected
}
