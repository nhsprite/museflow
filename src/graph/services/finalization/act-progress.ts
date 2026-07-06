import { logger } from '../../../utils/logger.js'
import type { ReducedGraphState } from '../../state.js'
import type { ModelProvider } from '../../../model/provider.js'
import type { ActArc, StoryArc } from '../../../types/outline.js'
import type { Issue } from '../../../types/agent.js'
import { readChapterContent } from '../../../storage/filesystem/writer.js'
import {
  getVerifiedBeatsFromMemory,
  judgeMandatoryBeatCoverage,
  judgeMandatoryBeatCoverageAcrossAct,
} from '../../../utils/story-arc.js'
import { createActPressureConstraint } from '../../../utils/verified-constraints.js'
import type { VerifiedConstraint } from '../../../types/verified-constraint.js'

export interface ActProgressUpdate {
  actProgress: ReducedGraphState['actProgress']
  beatPressureConstraint?: VerifiedConstraint
  beatVerificationIssues?: Issue[]
}

interface MandatoryBeatLocation {
  act: ActArc
  beat: string
}

export function getActForChapter(
  storyArc: StoryArc | null | undefined,
  chapterIndex: number
): ActArc | undefined {
  if (!storyArc) return undefined
  const chapterNumber = chapterIndex + 1
  return storyArc.acts.find((a) => chapterNumber >= a.startChapter && chapterNumber <= a.endChapter)
}

export function getPendingMandatoryBeats(state: ReducedGraphState, chapterIndex: number): string[] {
  const storyArc = state.storyArc
  const act = getActForChapter(storyArc, chapterIndex)
  if (!storyArc || !act) return []
  const progress = state.actProgress?.[act.index] ?? {
    consumed: [],
    pending: [...act.mandatoryBeats],
  }
  return act.mandatoryBeats.filter((beat) => !progress.consumed.includes(beat))
}

/**
 * Legacy outline-path helper: matches verified beat strings to act mandatory beat
 * strings by exact equality. This is fragile because LLMs may paraphrase beats.
 * It is kept only for runs without usable storyMemory; the memory path uses beat
 * IDs via getVerifiedBeatsFromMemory instead.
 */
export function normalizeVerifiedBeats(
  rawVerifiedBeats: string[],
  mandatoryBeats: string[]
): string[] {
  const matched = new Set<string>()
  const allowed = new Set(mandatoryBeats)
  for (const raw of rawVerifiedBeats) {
    if (allowed.has(raw)) {
      matched.add(raw)
    }
  }
  return Array.from(matched)
}

function findIssueMandatoryBeat(
  issue: Issue,
  storyArc: StoryArc | null | undefined
): MandatoryBeatLocation | undefined {
  if (!storyArc) return undefined

  const match = /^unverified-beat-(\d+)-(\d+)$/.exec(issue.id)
  if (!match || !match[1] || !match[2]) return undefined

  const actIndex = Number.parseInt(match[1], 10)
  const beatIndex = Number.parseInt(match[2], 10)
  if (!Number.isInteger(actIndex) || !Number.isInteger(beatIndex)) return undefined

  const act = storyArc.acts.find((candidate) => candidate.index === actIndex)
  const beat = act?.mandatoryBeats[beatIndex]
  return act && beat ? { act, beat } : undefined
}

export function pruneResolvedOutlineCoverageIssues(
  issues: Issue[],
  storyArc: StoryArc | null | undefined,
  actProgress: ReducedGraphState['actProgress'],
  currentChapterIndex: number
): Issue[] {
  return issues.filter((issue) => {
    if (issue.type !== 'outline_coverage' || issue.severity !== 'warning') {
      return true
    }

    const match = findIssueMandatoryBeat(issue, storyArc)
    if (!match) return true

    const progress = actProgress?.[match.act.index]
    if (progress?.consumed.includes(match.beat)) {
      return false
    }

    return currentChapterIndex + 1 <= match.act.endChapter
  })
}

export async function updateActProgress(
  state: ReducedGraphState,
  chapterIndex: number,
  provider?: ModelProvider
): Promise<ActProgressUpdate> {
  const hasUsableMemory =
    state.storyMemory && Object.values(state.storyMemory.beats).some((beat) => beat.actIndex !== 0)
  if (hasUsableMemory) {
    return updateActProgressFromMemory(state, chapterIndex)
  }
  return updateActProgressFromOutline(state, chapterIndex, provider)
}

function updateActProgressFromMemory(
  state: ReducedGraphState,
  chapterIndex: number
): ActProgressUpdate {
  const memory = state.storyMemory!
  const storyArc = state.storyArc
  const verifiedBeatIds = new Set(getVerifiedBeatsFromMemory(memory))

  // Map beat text to its keyBeat so we can verify any mandatory beat that has
  // a keyBeat ID, regardless of whether it was pre-populated in memory.beats.
  const textToKeyBeat = new Map(storyArc?.keyBeats.map((kb) => [kb.beat, kb] as const) ?? [])

  // outline.verifiedBeats may contain mandatory beat text that was recognized
  // by the fallback judge or directly derived from plot-advance events. When
  // keyBeat.beat text differs from mandatory beat text (e.g. model paraphrased),
  // these outline entries are the only structured signal we have.
  const outlineVerifiedBeats = new Set<string>()
  for (let idx = 0; idx <= chapterIndex; idx++) {
    const outlineItem = state.outline[idx]
    if (!outlineItem?.verifiedBeats) continue
    for (const act of storyArc?.acts ?? []) {
      for (const beat of normalizeVerifiedBeats(outlineItem.verifiedBeats, act.mandatoryBeats)) {
        outlineVerifiedBeats.add(beat)
      }
    }
  }

  const actProgress: ReducedGraphState['actProgress'] = {}
  for (const act of storyArc?.acts ?? []) {
    const consumed: string[] = []
    for (const beat of act.mandatoryBeats) {
      const keyBeat = textToKeyBeat.get(beat)
      const isVerifiedByMemory = keyBeat && verifiedBeatIds.has(keyBeat.id)
      const isVerifiedByOutline = outlineVerifiedBeats.has(beat)
      if (isVerifiedByMemory || isVerifiedByOutline) {
        if (!consumed.includes(beat)) consumed.push(beat)
      }
    }

    // Merge with existing actProgress so that rewriting a chapter does not
    // silently drop beats that were consumed in earlier chapters. This is
    // especially important when keyBeat text and mandatory beat text differ
    // and the memory path alone cannot map them back.
    const existing = state.actProgress?.[act.index]
    if (existing) {
      for (const beat of existing.consumed) {
        if (act.mandatoryBeats.includes(beat) && !consumed.includes(beat)) {
          consumed.push(beat)
        }
      }
    }

    const pending = act.mandatoryBeats.filter((beat) => !consumed.includes(beat))
    actProgress[act.index] = { consumed, pending }
  }

  const act = getActForChapter(storyArc, chapterIndex)
  let beatPressureConstraint: VerifiedConstraint | undefined
  let beatVerificationIssues: Issue[] | undefined

  if (act) {
    const progress = actProgress[act.index] ?? { consumed: [], pending: [] }
    const chaptersRemaining = act.endChapter - (chapterIndex + 1)
    const totalActChapters = act.endChapter - act.startChapter + 1
    const isInClosingPhase = chaptersRemaining / totalActChapters <= 0.2 && chaptersRemaining >= 0

    if (isInClosingPhase && progress.pending.length > 0) {
      logger.warn(
        `[MuseFlow] 第 ${act.index} 幕进入收尾阶段，仍有 ${progress.pending.length} 个 mandatory beats 未消费：${progress.pending.join('、')}`
      )
      beatPressureConstraint = createActPressureConstraint(
        act.index,
        `第 ${act.index} 幕「${act.title}」还剩 ${chaptersRemaining} 章结束，必须优先消费以下 mandatory beats：${progress.pending.join('、')}。本章及后续章节必须将推进这些节拍作为最高优先级，不得再扩展无关支线。`
      )
    }

    const currentOutline = state.outline[chapterIndex]
    const claimedBeats = getClaimedBeatTexts(currentOutline, act, storyArc)
    beatVerificationIssues = buildBeatVerificationIssues(
      claimedBeats,
      progress.consumed,
      act,
      chapterIndex
    )
  }

  const result: ActProgressUpdate = { actProgress }
  if (beatPressureConstraint) {
    result.beatPressureConstraint = beatPressureConstraint
  }
  if (beatVerificationIssues && beatVerificationIssues.length > 0) {
    result.beatVerificationIssues = beatVerificationIssues
  }
  return result
}

function getClaimedBeatTexts(
  outlineItem: ReducedGraphState['outline'][number] | undefined,
  act: ActArc,
  storyArc: StoryArc | null | undefined
): string[] {
  if (!outlineItem) return []
  const claimed = new Set<string>()
  if (outlineItem.claimedBeatIds && storyArc) {
    for (const id of outlineItem.claimedBeatIds) {
      const keyBeat = storyArc.keyBeats.find((kb) => kb.id === id)
      if (keyBeat && act.mandatoryBeats.includes(keyBeat.beat)) {
        claimed.add(keyBeat.beat)
      }
    }
  }
  if (outlineItem.claimedBeats) {
    for (const beat of outlineItem.claimedBeats) {
      if (act.mandatoryBeats.includes(beat)) {
        claimed.add(beat)
      }
    }
  }
  return Array.from(claimed)
}

/**
 * Legacy outline-only fallback for act progress. Uses exact string matching
 * between outline.verifiedBeats and act.mandatoryBeats. Prefer
 * updateActProgressFromMemory when storyMemory is available.
 */
async function updateActProgressFromOutline(
  state: ReducedGraphState,
  chapterIndex: number,
  provider?: ModelProvider
): Promise<ActProgressUpdate> {
  const storyArc = state.storyArc
  const act = getActForChapter(storyArc, chapterIndex)
  if (!storyArc || !act) {
    return { actProgress: state.actProgress }
  }

  const currentOutline = state.outline[chapterIndex]
  const claimedBeats = currentOutline?.claimedBeats ?? []
  const rawVerifiedBeats = currentOutline?.verifiedBeats ?? []

  // Historical summaries can be narrative; normalize them back to exact mandatory beat text.
  const verifiedBeats = normalizeVerifiedBeats(rawVerifiedBeats, act.mandatoryBeats)

  const consumed: string[] = []
  for (let idx = act.startChapter - 1; idx <= chapterIndex; idx++) {
    const outlineItem = state.outline[idx]
    if (!outlineItem) continue
    const normalized = normalizeVerifiedBeats(outlineItem.verifiedBeats ?? [], act.mandatoryBeats)
    for (const beat of normalized) {
      if (!consumed.includes(beat)) {
        consumed.push(beat)
      }
    }
  }
  let pending = act.mandatoryBeats.filter((beat) => !consumed.includes(beat))

  const chaptersRemaining = act.endChapter - (chapterIndex + 1)
  const totalActChapters = act.endChapter - act.startChapter + 1
  const isInClosingPhase = chaptersRemaining / totalActChapters <= 0.2 && chaptersRemaining >= 0

  if (isInClosingPhase && pending.length > 0 && provider) {
    const retroactive = await judgeMandatoryBeatCoverageAcrossAct(
      provider,
      act,
      pending,
      state.chapterSummaries,
      state.outline.map((o) => o.description ?? '')
    )
    for (const beat of retroactive) {
      if (!consumed.includes(beat)) {
        consumed.push(beat)
      }
    }
    pending = act.mandatoryBeats.filter((beat) => !consumed.includes(beat))

    if (pending.length > 0) {
      const contentVerified = await scanActChaptersForBeats(
        state.story.outputDir,
        act,
        pending,
        provider,
        state.outline,
        chapterIndex
      )
      for (const beat of contentVerified) {
        if (!consumed.includes(beat)) {
          consumed.push(beat)
        }
      }
      pending = act.mandatoryBeats.filter((beat) => !consumed.includes(beat))
    }
  }

  const updatedActProgress: ReducedGraphState['actProgress'] = {
    ...state.actProgress,
    [act.index]: { consumed, pending },
  }

  const beatVerificationIssues = buildBeatVerificationIssues(
    claimedBeats,
    verifiedBeats,
    act,
    chapterIndex
  )

  if (isInClosingPhase && pending.length > 0) {
    logger.warn(
      `[MuseFlow] 第 ${act.index} 幕进入收尾阶段，仍有 ${pending.length} 个 mandatory beats 未消费：${pending.join('、')}`
    )
    return {
      actProgress: updatedActProgress,
      beatPressureConstraint: createActPressureConstraint(
        act.index,
        `第 ${act.index} 幕「${act.title}」还剩 ${chaptersRemaining} 章结束，必须优先消费以下 mandatory beats：${pending.join('、')}。本章及后续章节必须将推进这些节拍作为最高优先级，不得再扩展无关支线。`
      ),
      beatVerificationIssues,
    }
  }

  const currentActIndex = act.index
  const overdueKeyBeats = storyArc.keyBeats.filter(
    (kb) =>
      kb.deadlineAct <= currentActIndex &&
      !consumed.includes(kb.beat) &&
      !verifiedBeats.includes(kb.beat)
  )
  if (overdueKeyBeats.length > 0 && chaptersRemaining === 0) {
    logger.warn(
      `[MuseFlow] 第 ${act.index} 幕结束时有 ${overdueKeyBeats.length} 个全局 key beats 逾期未消费：${overdueKeyBeats.map((k) => k.beat).join('、')}`
    )
  }

  return { actProgress: updatedActProgress, beatVerificationIssues }
}

/**
 * Legacy outline-only helper: compares claimed and verified beats by exact
 * string equality. Only called from updateActProgressFromOutline.
 */
function buildBeatVerificationIssues(
  claimedBeats: string[],
  verifiedBeats: string[],
  act: ActArc,
  _chapterIndex: number
): Issue[] {
  const issues: Issue[] = []
  const unverifiedClaimed = claimedBeats.filter((beat) => !verifiedBeats.includes(beat))
  for (const beat of unverifiedClaimed) {
    const beatIndex = act.mandatoryBeats.indexOf(beat)
    if (beatIndex >= 0) {
      issues.push({
        id: `unverified-beat-${act.index}-${beatIndex}`,
        type: 'outline_coverage',
        severity: 'warning',
        description: `本章大纲声称推进 mandatory beat「${beat}」，但正文未验证到该 beat 的发生。`,
        suggestion: `请在后续章节中确保该 beat 被明确确立，或调整大纲不再声称推进该 beat。`,
      })
    }
  }
  return issues
}

async function scanActChaptersForBeats(
  outputDir: string,
  act: ActArc,
  pendingBeats: string[],
  provider: ModelProvider,
  outline: ReducedGraphState['outline'],
  currentChapterIndex: number
): Promise<string[]> {
  const newlyVerified: string[] = []
  let remaining = [...pendingBeats]

  for (
    let chapterNumber = act.startChapter;
    chapterNumber <= Math.min(act.endChapter, currentChapterIndex + 1);
    chapterNumber++
  ) {
    if (remaining.length === 0) break
    const content = await readChapterContent(outputDir, chapterNumber)
    if (!content || content.trim().length === 0) continue

    const found = await judgeMandatoryBeatCoverage(provider, content, remaining)
    if (found.length === 0) continue

    const outlineIndex = chapterNumber - 1
    const outlineItem = outline[outlineIndex]
    if (outlineItem) {
      const mergedVerified = Array.from(new Set([...(outlineItem.verifiedBeats ?? []), ...found]))
      outline[outlineIndex] = { ...outlineItem, verifiedBeats: mergedVerified }
    }

    for (const beat of found) {
      if (!newlyVerified.includes(beat)) {
        newlyVerified.push(beat)
      }
      remaining = remaining.filter((b) => b !== beat)
    }
  }

  return newlyVerified
}
