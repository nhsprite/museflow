import { logger } from '../../../utils/logger.js'
import type { ReducedGraphState } from '../../state.js'
import type { ActArc, StoryArc } from '../../../types/outline.js'
import type { Issue } from '../../../types/agent.js'
import type { BeatId, StoryMemory } from '../../../types/story-memory.js'
import { getVerifiedBeatsFromMemory } from '../../../utils/story-arc.js'
import { createActPressureConstraint } from '../../../utils/verified-constraints.js'
import {
  findMandatoryBeatById,
  getMandatoryBeatEntriesForAct,
} from '../../../utils/mandatory-beat-ids.js'
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
  return [...progress.pending]
}

export function pruneResolvedOutlineCoverageIssues(
  issues: Issue[],
  storyArc: StoryArc | null | undefined,
  currentChapterIndex: number,
  storyMemory?: StoryMemory | null
): Issue[] {
  return issues.filter((issue) => {
    if (issue.type !== 'outline_coverage') {
      return true
    }

    if (issue.subject) {
      const beat = storyMemory?.beats[issue.subject]
      if (beat && beat.provenByEventIds.length > 0) {
        return false
      }
    }

    if (!issue.subject) return true
    const mandatoryBeat = findMandatoryBeatById(storyArc, issue.subject)
    if (mandatoryBeat) {
      return currentChapterIndex + 1 <= mandatoryBeat.act.endChapter
    }

    const keyBeat = storyArc?.keyBeats.find((beat) => beat.id === issue.subject)
    const currentAct = getActForChapter(storyArc, currentChapterIndex)
    return !keyBeat || !currentAct || currentAct.index <= keyBeat.deadlineAct
  })
}

export async function updateActProgress(
  state: ReducedGraphState,
  chapterIndex: number,
  actClosingPhaseRatio: number
): Promise<ActProgressUpdate> {
  return updateActProgressFromStructuredIds(state, chapterIndex, actClosingPhaseRatio)
}

function updateActProgressFromStructuredIds(
  state: ReducedGraphState,
  chapterIndex: number,
  actClosingPhaseRatio: number
): ActProgressUpdate {
  const storyArc = state.storyArc
  const verifiedBeatIds = new Set(
    state.storyMemory ? getVerifiedBeatsFromMemory(state.storyMemory) : []
  )
  for (let idx = 0; idx <= chapterIndex; idx++) {
    const outlineItem = state.outline[idx]
    for (const beatId of outlineItem?.verifiedMandatoryBeatIds ?? []) {
      verifiedBeatIds.add(beatId)
    }
  }

  const actProgress: ReducedGraphState['actProgress'] = {}
  for (const act of storyArc?.acts ?? []) {
    const entries = getMandatoryBeatEntriesForAct(act)
    const consumed = entries
      .filter((entry) => verifiedBeatIds.has(entry.id))
      .map((entry) => entry.beat)
    const pending = entries
      .filter((entry) => !verifiedBeatIds.has(entry.id))
      .map((entry) => entry.beat)
    actProgress[act.index] = { consumed, pending }
  }

  const act = getActForChapter(storyArc, chapterIndex)
  let beatPressureConstraint: VerifiedConstraint | undefined
  let beatVerificationIssues: Issue[] | undefined

  if (act) {
    const progress = actProgress[act.index] ?? { consumed: [], pending: [] }
    const chaptersRemaining = act.endChapter - (chapterIndex + 1)
    const isInClosingPhase = isActClosingPhase(act, chapterIndex, actClosingPhaseRatio)

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
    beatVerificationIssues = buildBeatVerificationIssues(
      currentOutline,
      verifiedBeatIds,
      act,
      chapterIndex,
      actClosingPhaseRatio,
      storyArc
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

function buildBeatVerificationIssues(
  outlineItem: ReducedGraphState['outline'][number] | undefined,
  verifiedBeatIds: ReadonlySet<BeatId>,
  act: ActArc,
  chapterIndex: number,
  actClosingPhaseRatio: number,
  storyArc?: StoryArc | null
): Issue[] {
  const issues: Issue[] = []
  const shouldBlock = shouldBlockUnverifiedClaimedBeat(act, chapterIndex, actClosingPhaseRatio)
  const keyBeatsById = new Map(storyArc?.keyBeats.map((beat) => [beat.id, beat] as const) ?? [])

  for (const beatId of outlineItem?.claimedMandatoryBeatIds ?? []) {
    const lookup = findMandatoryBeatById(storyArc, beatId)
    if (!lookup || lookup.act.index !== act.index) continue
    const proven = verifiedBeatIds.has(beatId)
    if (proven) continue

    issues.push({
      id: `unverified-mandatory-beat-id-${beatId}`,
      ruleId: 'outline-coverage.unverified-mandatory-beat',
      type: 'outline_coverage',
      severity: shouldBlock ? 'error' : 'warning',
      subject: beatId,
      description: `本章大纲声称推进 mandatory beat「${lookup.beat}」，但正文未验证到该 beat 的发生。`,
      suggestion: shouldBlock
        ? `请重写当前章节，补足该 mandatory beat 的明确推进事件，或调整大纲不再声称本章推进该 beat。`
        : `请在后续章节中确保该 beat 被明确确立，或调整大纲不再声称推进该 beat。`,
      source: 'outline_compliance',
      ...(shouldBlock ? { retryStrategy: 'draft' as const } : {}),
    })
  }

  for (const beatId of outlineItem?.claimedBeatIds ?? []) {
    const keyBeat = keyBeatsById.get(beatId)
    if (!keyBeat || keyBeat.deadlineAct !== act.index) continue
    const proven = verifiedBeatIds.has(beatId)
    if (proven) continue

    issues.push({
      id: `unverified-beat-id-${beatId}`,
      ruleId: 'outline-coverage.unverified-key-beat',
      type: 'outline_coverage',
      severity: shouldBlock ? 'error' : 'warning',
      subject: beatId,
      description: `本章大纲声称推进 key beat「${keyBeat.beat}」，但正文未验证到该 beat 的发生。`,
      suggestion: shouldBlock
        ? `请重写当前章节，补足该 key beat 的明确推进事件，或调整大纲不再声称本章推进该 beat。`
        : `请在后续章节中确保该 key beat 被明确确立，或调整大纲不再声称推进该 beat。`,
      source: 'outline_compliance',
      ...(shouldBlock ? { retryStrategy: 'draft' as const } : {}),
    })
  }
  return issues
}

function isActClosingPhase(
  act: ActArc,
  chapterIndex: number,
  actClosingPhaseRatio: number
): boolean {
  const chaptersRemaining = act.endChapter - (chapterIndex + 1)
  const totalActChapters = act.endChapter - act.startChapter + 1
  return chaptersRemaining >= 0 && chaptersRemaining / totalActChapters <= actClosingPhaseRatio
}

function shouldBlockUnverifiedClaimedBeat(
  act: ActArc,
  chapterIndex: number,
  actClosingPhaseRatio: number
): boolean {
  const chaptersRemaining = act.endChapter - (chapterIndex + 1)
  return chaptersRemaining <= 1 || isActClosingPhase(act, chapterIndex, actClosingPhaseRatio)
}
