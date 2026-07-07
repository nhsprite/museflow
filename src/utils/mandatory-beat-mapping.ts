import type { ChapterOutline, StoryArc } from '../types/outline.js'
import type { BeatId } from '../types/story-memory.js'

type BeatClaimOutline = Pick<ChapterOutline, 'claimedBeats' | 'claimedBeatIds'> | undefined

interface FindClaimedMandatoryBeatOptions {
  preferredChapterIndex?: number
  throughChapterIndex?: number
}

export function getClaimedMandatoryBeatForId(
  outlineItem: BeatClaimOutline,
  storyArc: StoryArc | null | undefined,
  beatId: BeatId
): string | undefined {
  if (!outlineItem || !storyArc) return undefined

  const keyBeat = storyArc.keyBeats.find((beat) => beat.id === beatId)
  if (!keyBeat) return undefined

  const act = storyArc.acts.find((candidate) => candidate.index === keyBeat.deadlineAct)
  if (!act) return undefined

  const claimedIds = outlineItem.claimedBeatIds ?? []
  const claimedBeats = outlineItem.claimedBeats ?? []
  const limit = Math.min(claimedIds.length, claimedBeats.length)

  for (let index = 0; index < limit; index++) {
    if (claimedIds[index] !== beatId) continue
    const claimedBeat = claimedBeats[index]
    if (claimedBeat && act.mandatoryBeats.includes(claimedBeat)) {
      return claimedBeat
    }
  }

  return undefined
}

export function buildClaimedMandatoryBeatMap(
  outline: readonly BeatClaimOutline[],
  storyArc: StoryArc | null | undefined,
  throughChapterIndex = outline.length - 1
): Map<BeatId, string> {
  const mapped = new Map<BeatId, string>()
  if (!storyArc) return mapped

  const lastIndex = Math.min(outline.length - 1, throughChapterIndex)
  for (let chapterIndex = 0; chapterIndex <= lastIndex; chapterIndex++) {
    const outlineItem = outline[chapterIndex]
    for (const beatId of outlineItem?.claimedBeatIds ?? []) {
      const claimedBeat = getClaimedMandatoryBeatForId(outlineItem, storyArc, beatId)
      if (claimedBeat) {
        mapped.set(beatId, claimedBeat)
      }
    }
  }

  return mapped
}

export function findClaimedMandatoryBeatForId(
  outline: readonly BeatClaimOutline[],
  storyArc: StoryArc | null | undefined,
  beatId: BeatId,
  options: FindClaimedMandatoryBeatOptions = {}
): string | undefined {
  if (!storyArc) return undefined

  const throughChapterIndex = options.throughChapterIndex ?? outline.length - 1
  const preferredChapterIndex = options.preferredChapterIndex
  if (
    preferredChapterIndex !== undefined &&
    preferredChapterIndex >= 0 &&
    preferredChapterIndex <= throughChapterIndex
  ) {
    const preferred = getClaimedMandatoryBeatForId(outline[preferredChapterIndex], storyArc, beatId)
    if (preferred) return preferred
  }

  return buildClaimedMandatoryBeatMap(outline, storyArc, throughChapterIndex).get(beatId)
}
