import { logger } from '../../../utils/logger.js'
import type { ReducedGraphState } from '../../state.js'
import type { ModelProvider } from '../../../model/provider.js'
import type { ActArc, StoryArc } from '../../../types/outline.js'
import type { Issue } from '../../../types/agent.js'
import { readChapterContent } from '../../../storage/filesystem/writer.js'
import {
  judgeMandatoryBeatCoverage,
  judgeMandatoryBeatCoverageAcrossAct,
  matchMandatoryBeat,
} from '../../../utils/story-arc.js'
import { createActPressureConstraint } from '../../../utils/verified-constraints.js'
import type { VerifiedConstraint } from '../../../types/verified-constraint.js'

export interface ActProgressUpdate {
  actProgress: ReducedGraphState['actProgress']
  beatPressureConstraint?: VerifiedConstraint
  beatVerificationIssues?: Issue[]
}

export function getActForChapter(
  storyArc: StoryArc | null | undefined,
  chapterIndex: number
): ActArc | undefined {
  if (!storyArc) return undefined
  const chapterNumber = chapterIndex + 1
  return storyArc.acts.find(a => chapterNumber >= a.startChapter && chapterNumber <= a.endChapter)
}

export function getPendingMandatoryBeats(
  state: ReducedGraphState,
  chapterIndex: number
): string[] {
  const storyArc = state.storyArc
  const act = getActForChapter(storyArc, chapterIndex)
  if (!storyArc || !act) return []
  const progress = state.actProgress?.[act.index] ?? { consumed: [], pending: [...act.mandatoryBeats] }
  return act.mandatoryBeats.filter(beat => !progress.consumed.includes(beat))
}

export function normalizeVerifiedBeats(
  rawVerifiedBeats: string[],
  mandatoryBeats: string[]
): string[] {
  const matched = new Set<string>()
  for (const raw of rawVerifiedBeats) {
    const candidate = matchMandatoryBeat(raw, mandatoryBeats)
    if (candidate) {
      matched.add(candidate)
    }
  }
  return Array.from(matched)
}

export async function updateActProgress(
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
  let pending = act.mandatoryBeats.filter(beat => !consumed.includes(beat))

  const chaptersRemaining = act.endChapter - (chapterIndex + 1)
  const totalActChapters = act.endChapter - act.startChapter + 1
  const isInClosingPhase = chaptersRemaining / totalActChapters <= 0.2 && chaptersRemaining >= 0

  if (isInClosingPhase && pending.length > 0 && provider) {
    const retroactive = await judgeMandatoryBeatCoverageAcrossAct(
      provider,
      act,
      pending,
      state.chapterSummaries,
      state.outline.map(o => o.description ?? '')
    )
    for (const beat of retroactive) {
      if (!consumed.includes(beat)) {
        consumed.push(beat)
      }
    }
    pending = act.mandatoryBeats.filter(beat => !consumed.includes(beat))

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
      pending = act.mandatoryBeats.filter(beat => !consumed.includes(beat))
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
    kb => kb.deadlineAct <= currentActIndex && !consumed.includes(kb.beat) && !verifiedBeats.includes(kb.beat)
  )
  if (overdueKeyBeats.length > 0 && chaptersRemaining === 0) {
    logger.warn(
      `[MuseFlow] 第 ${act.index} 幕结束时有 ${overdueKeyBeats.length} 个全局 key beats 逾期未消费：${overdueKeyBeats.map(k => k.beat).join('、')}`
    )
  }

  return { actProgress: updatedActProgress, beatVerificationIssues }
}

function buildBeatVerificationIssues(
  claimedBeats: string[],
  verifiedBeats: string[],
  act: ActArc,
  chapterIndex: number
): Issue[] {
  const issues: Issue[] = []
  const unverifiedClaimed = claimedBeats.filter(beat => !verifiedBeats.includes(beat))
  for (const beat of unverifiedClaimed) {
    if (act.mandatoryBeats.includes(beat)) {
      issues.push({
        id: `unverified-beat-${chapterIndex}-${beat}`,
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

  for (let chapterNumber = act.startChapter; chapterNumber <= Math.min(act.endChapter, currentChapterIndex + 1); chapterNumber++) {
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
      remaining = remaining.filter(b => b !== beat)
    }
  }

  return newlyVerified
}
