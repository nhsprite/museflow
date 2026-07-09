import type { ActArc, StoryArc } from '../types/outline.js'

export interface MandatoryBeatEntry {
  id: string
  actIndex: number
  beatIndex: number
  beat: string
}

export interface MandatoryBeatLookup {
  act: ActArc
  beat: string
  beatIndex: number
}

const MANDATORY_BEAT_ID_RE = /^A(\d+)-M(\d+)$/

export function makeMandatoryBeatId(actIndex: number, beatIndex: number): string {
  return `A${actIndex}-M${beatIndex + 1}`
}

export function getMandatoryBeatEntriesForAct(act: ActArc): MandatoryBeatEntry[] {
  return act.mandatoryBeats.map((beat, beatIndex) => ({
    id: makeMandatoryBeatId(act.index, beatIndex),
    actIndex: act.index,
    beatIndex,
    beat,
  }))
}

export function getMandatoryBeatEntries(
  storyArc: StoryArc | null | undefined
): MandatoryBeatEntry[] {
  return (storyArc?.acts ?? []).flatMap(getMandatoryBeatEntriesForAct)
}

export function findMandatoryBeatById(
  storyArc: StoryArc | null | undefined,
  beatId: string
): MandatoryBeatLookup | undefined {
  if (!storyArc) return undefined

  const match = MANDATORY_BEAT_ID_RE.exec(beatId)
  if (!match || !match[1] || !match[2]) return undefined

  const actIndex = Number.parseInt(match[1], 10)
  const oneBasedBeatIndex = Number.parseInt(match[2], 10)
  if (!Number.isInteger(actIndex) || !Number.isInteger(oneBasedBeatIndex)) {
    return undefined
  }

  const act = storyArc.acts.find((candidate) => candidate.index === actIndex)
  const beatIndex = oneBasedBeatIndex - 1
  const beat = act?.mandatoryBeats[beatIndex]
  return act && beat ? { act, beat, beatIndex } : undefined
}

export function getMandatoryBeatTextById(
  storyArc: StoryArc | null | undefined,
  beatId: string
): string | undefined {
  return findMandatoryBeatById(storyArc, beatId)?.beat
}

export function getMandatoryBeatIdByText(
  storyArc: StoryArc | null | undefined,
  actIndex: number,
  beat: string
): string | undefined {
  const act = storyArc?.acts.find((candidate) => candidate.index === actIndex)
  const beatIndex = act?.mandatoryBeats.indexOf(beat) ?? -1
  return beatIndex >= 0 && act ? makeMandatoryBeatId(act.index, beatIndex) : undefined
}
