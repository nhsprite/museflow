import type { StoryArc } from '../types/outline.js'
import type { BeatId, StoryMemory } from '../types/story-memory.js'
import { findMandatoryBeatById } from './mandatory-beat-ids.js'

function directBeatProofExists(memory: StoryMemory | null | undefined, beatId: BeatId): boolean {
  return (memory?.beats[beatId]?.provenByEventIds.length ?? 0) > 0
}

export function getCoveredMandatoryBeatId(
  storyArc: StoryArc | null | undefined,
  beatId: BeatId
): BeatId | undefined {
  const keyBeat = storyArc?.keyBeats.find((candidate) => candidate.id === beatId)
  const coveredBy = keyBeat?.coveredByMandatoryBeatId
  if (!coveredBy) return undefined

  const mandatoryBeat = findMandatoryBeatById(storyArc, coveredBy)
  if (!mandatoryBeat || mandatoryBeat.act.index > keyBeat.deadlineAct) return undefined
  return coveredBy
}

export function isBeatProven(
  storyArc: StoryArc | null | undefined,
  memory: StoryMemory | null | undefined,
  beatId: BeatId
): boolean {
  if (directBeatProofExists(memory, beatId)) return true
  const coveredBy = getCoveredMandatoryBeatId(storyArc, beatId)
  return coveredBy !== undefined && directBeatProofExists(memory, coveredBy)
}

export function getVerifiedBeatIdsWithCoverage(
  memory: StoryMemory,
  storyArc?: StoryArc | null
): BeatId[] {
  const verified = new Set<BeatId>(
    Object.values(memory.beats)
      .filter((beat) => beat.provenByEventIds.length > 0)
      .map((beat) => beat.id)
  )
  for (const keyBeat of storyArc?.keyBeats ?? []) {
    if (isBeatProven(storyArc, memory, keyBeat.id)) verified.add(keyBeat.id)
  }
  return [...verified]
}

export function mergeKeyBeatCoverageMetadata(
  storyArc: StoryArc | null | undefined,
  authorityArc: StoryArc | null | undefined
): StoryArc | null | undefined {
  if (!storyArc || !authorityArc) return storyArc
  const authorityById = new Map(authorityArc.keyBeats.map((beat) => [beat.id, beat] as const))
  let changed = false
  const keyBeats = storyArc.keyBeats.map((beat) => {
    const authorityBeat = authorityById.get(beat.id)
    if (!authorityBeat || authorityBeat.coveredByMandatoryBeatId === undefined) return beat
    if (beat.coveredByMandatoryBeatId === authorityBeat.coveredByMandatoryBeatId) return beat
    changed = true
    return { ...beat, coveredByMandatoryBeatId: authorityBeat.coveredByMandatoryBeatId }
  })
  return changed ? { ...storyArc, keyBeats } : storyArc
}
