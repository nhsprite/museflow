import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../../graph/state.js'
import type { ChapterOutlineResult } from '../../agents/chapter-outline.js'
import { getCoveredMandatoryBeatId, isBeatProven } from '../../utils/beat-coverage.js'
import { getActForChapter } from '../../utils/story-arc.js'
import { findMandatoryBeatById } from '../../utils/mandatory-beat-ids.js'

export function isBeatAlreadyProven(state: ReducedGraphState, beatId: string): boolean {
  return isBeatProven(state.storyArc, state.storyMemory, beatId)
}

export function filterClaimedMandatoryBeatPairsToCurrentAct(
  claimedMandatoryBeatIds: string[] | undefined,
  state: ReducedGraphState,
  chapterIndex: number
): Array<{ beat: string; id: string }> {
  const currentAct = getActForChapter(state.storyArc, chapterIndex)
  if (!currentAct) return []

  const pairs: Array<{ beat: string; id: string }> = []
  const addPair = (beat: string, id: string) => {
    if (!pairs.some((pair) => pair.id === id)) {
      pairs.push({ beat, id })
    }
  }

  for (const id of claimedMandatoryBeatIds ?? []) {
    const trimmed = id.trim()
    const lookup = findMandatoryBeatById(state.storyArc, trimmed)
    if (!lookup || lookup.act.index !== currentAct?.index) continue
    if (isBeatAlreadyProven(state, trimmed)) {
      logger.info(
        `[MuseFlow] 第 ${chapterIndex + 1} 章声称的节拍 ${trimmed} 已在之前章节被证明，跳过`
      )
      continue
    }
    addPair(lookup.beat, trimmed)
  }

  return pairs
}

function filterClaimedKeyBeatIdsToStoryArc(
  claimedBeatIds: string[] | undefined,
  state: ReducedGraphState,
  chapterIndex: number
): string[] {
  if (!state.storyArc) return []
  const currentAct = getActForChapter(state.storyArc, chapterIndex)
  const allowed = new Set(
    state.storyArc.keyBeats
      .filter(
        (beat) =>
          getCoveredMandatoryBeatId(state.storyArc, beat.id) === undefined &&
          (!currentAct || beat.deadlineAct === currentAct.index)
      )
      .map((beat) => beat.id)
  )
  const result: string[] = []
  for (const id of claimedBeatIds ?? []) {
    const trimmed = id.trim()
    if (allowed.has(trimmed) && !result.includes(trimmed)) {
      result.push(trimmed)
    }
  }
  return result
}

export function finalizeChapterOutlineCandidate(
  candidate: ChapterOutlineResult,
  state: ReducedGraphState,
  chapterIndex: number,
  beatBudget: number
): ChapterOutlineResult {
  const filteredClaimedBeatPairs = filterClaimedMandatoryBeatPairsToCurrentAct(
    candidate.claimedMandatoryBeatIds,
    state,
    chapterIndex
  )
  const cappedClaimedBeatPairs =
    beatBudget > 0 ? filteredClaimedBeatPairs.slice(0, beatBudget) : filteredClaimedBeatPairs
  const cappedClaimedBeats = cappedClaimedBeatPairs.map((pair) => pair.beat)
  const cappedClaimedMandatoryBeatIds = cappedClaimedBeatPairs.map((pair) => pair.id)
  const claimedBeatIds = filterClaimedKeyBeatIdsToStoryArc(
    candidate.claimedBeatIds,
    state,
    chapterIndex
  )
  if (filteredClaimedBeatPairs.length > cappedClaimedBeatPairs.length) {
    logger.info(
      `[MuseFlow] 第 ${chapterIndex + 1} 章声称节拍 ${filteredClaimedBeatPairs.length} 个，超出预算 ${beatBudget} 个，已裁剪为：${cappedClaimedBeats.join('、') || '（无）'}`
    )
  }

  return {
    ...candidate,
    claimedBeats: cappedClaimedBeats,
    claimedMandatoryBeatIds: cappedClaimedMandatoryBeatIds,
    claimedBeatIds,
  }
}

/** 收集最终保留的节拍认领，供大纲描述语义校验使用。 */
export function collectClaimsForBeatVerification(
  candidate: ChapterOutlineResult,
  state: ReducedGraphState,
  chapterIndex: number,
  beatBudget: number
): Array<{ beatId: string; beat: string }> {
  const mandatoryPairs = filterClaimedMandatoryBeatPairsToCurrentAct(
    candidate.claimedMandatoryBeatIds,
    state,
    chapterIndex
  )
  const cappedMandatoryPairs = beatBudget > 0 ? mandatoryPairs.slice(0, beatBudget) : mandatoryPairs
  const keyBeatIds = filterClaimedKeyBeatIdsToStoryArc(
    candidate.claimedBeatIds,
    state,
    chapterIndex
  )
  const keyBeatClaims = keyBeatIds.flatMap((id) => {
    const beat = state.storyArc?.keyBeats.find((keyBeat) => keyBeat.id === id)?.beat
    return beat ? [{ beatId: id, beat }] : []
  })
  return [
    ...cappedMandatoryPairs.map((pair) => ({ beatId: pair.id, beat: pair.beat })),
    ...keyBeatClaims,
  ]
}

export function stripRejectedBeatClaims(
  candidate: ChapterOutlineResult,
  rejectedBeatClaimIds: readonly string[]
): ChapterOutlineResult {
  if (rejectedBeatClaimIds.length === 0) return candidate
  const rejected = new Set(rejectedBeatClaimIds)
  return {
    ...candidate,
    claimedMandatoryBeatIds: (candidate.claimedMandatoryBeatIds ?? []).filter(
      (id) => !rejected.has(id)
    ),
    claimedBeatIds: (candidate.claimedBeatIds ?? []).filter((id) => !rejected.has(id)),
  }
}

export function candidateHasBeatClaim(candidate: ChapterOutlineResult, beatId: string): boolean {
  return (
    (candidate.claimedMandatoryBeatIds ?? []).includes(beatId) ||
    (candidate.claimedBeatIds ?? []).includes(beatId)
  )
}
