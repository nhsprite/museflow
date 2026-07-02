import type { ActArc, KeyBeat, StoryArc } from '../types/outline.js'

export function getActForChapter(storyArc: StoryArc | null | undefined, chapterIndex: number): ActArc | undefined {
  if (!storyArc) return undefined
  const chapterNumber = chapterIndex + 1
  return storyArc.acts.find(a => chapterNumber >= a.startChapter && chapterNumber <= a.endChapter)
}

export function isClosingPhase(totalChapters: number, currentChapterIndex: number, ratio = 0.15): boolean {
  return currentChapterIndex + 1 >= totalChapters * (1 - ratio)
}

export interface ArcStatus {
  currentAct: ActArc | undefined
  actsTotal: number
  chaptersRemaining: number
  closingPhase: boolean
  beatsTotal: number
  beatsConsumed: number
  beatsPending: string[]
  overdueKeyBeats: KeyBeat[]
  upcomingKeyBeats: KeyBeat[]
  riskLevel: 'low' | 'medium' | 'high'
}

export function buildArcStatus(
  storyArc: StoryArc,
  actProgress: Record<number, { consumed: string[]; pending: string[] }>,
  currentChapterIndex: number
): ArcStatus {
  const currentAct = getActForChapter(storyArc, currentChapterIndex)
  const chaptersRemaining = storyArc.totalChapters - (currentChapterIndex + 1)
  const closingPhase = isClosingPhase(storyArc.totalChapters, currentChapterIndex)

  const progress = currentAct
    ? (actProgress[currentAct.index] ?? { consumed: [], pending: [...currentAct.mandatoryBeats] })
    : { consumed: [], pending: [] }

  const beatsTotal = currentAct ? currentAct.mandatoryBeats.length : 0
  const beatsConsumed = progress.consumed.length
  const beatsPending = progress.pending

  const currentActIndex = currentAct?.index ?? 0
  const overdueKeyBeats = storyArc.keyBeats.filter(
    kb => kb.deadlineAct < currentActIndex && !progress.consumed.includes(kb.beat)
  )
  const upcomingKeyBeats = storyArc.keyBeats.filter(
    kb => kb.deadlineAct === currentActIndex && !progress.consumed.includes(kb.beat)
  )

  let riskLevel: ArcStatus['riskLevel'] = 'low'
  if (
    overdueKeyBeats.length > 0 ||
    (currentAct && beatsPending.length > currentAct.endChapter - (currentChapterIndex + 1))
  ) {
    riskLevel = 'high'
  } else if (
    upcomingKeyBeats.length > 0 ||
    (currentAct && beatsPending.length > 0 && currentAct.endChapter - (currentChapterIndex + 1) <= 2)
  ) {
    riskLevel = 'medium'
  }

  return {
    currentAct,
    actsTotal: storyArc.acts.length,
    chaptersRemaining,
    closingPhase,
    beatsTotal,
    beatsConsumed,
    beatsPending,
    overdueKeyBeats,
    upcomingKeyBeats,
    riskLevel,
  }
}

export interface ActBoundaryProposal {
  actIndex: number
  proposedEndChapter: number
  reason: string
}

export function buildClosingPhaseConstraint(
  storyArc: StoryArc,
  actProgress: Record<number, { consumed: string[]; pending: string[] }>,
  currentChapterIndex: number,
  ratio = 0.15
): string | undefined {
  if (!isClosingPhase(storyArc.totalChapters, currentChapterIndex, ratio)) return undefined

  const currentAct = getActForChapter(storyArc, currentChapterIndex)
  const currentActIndex = currentAct?.index ?? storyArc.acts.length
  const chaptersRemaining = storyArc.totalChapters - (currentChapterIndex + 1)

  const pendingBeats: string[] = []
  for (const act of storyArc.acts) {
    if (act.index > currentActIndex) continue
    const progress = actProgress[act.index] ?? { consumed: [], pending: [...act.mandatoryBeats] }
    for (const beat of progress.pending) {
      if (!pendingBeats.includes(beat)) pendingBeats.push(beat)
    }
  }

  const pendingKeyBeats = storyArc.keyBeats.filter(
    kb => !pendingBeats.includes(kb.beat) && kb.deadlineAct <= currentActIndex
  )

  const parts: string[] = [
    `【全书收尾阶段】本书仅剩 ${chaptersRemaining} 章结束。`,
    '禁止引入新的主要支线、新角色或新的未解悬念。',
  ]
  if (pendingBeats.length > 0) {
    parts.push(`必须优先消费以下仍未消费的 mandatory beats：${pendingBeats.join('、')}。`)
  }
  if (pendingKeyBeats.length > 0) {
    parts.push(`必须回收以下逾期/即将到期的关键节拍：${pendingKeyBeats.map(k => k.beat).join('、')}。`)
  }
  parts.push('本章必须向最终高潮/结局推进，不得扩展无关过渡场景。')
  return parts.join('')
}

export function proposeActBoundaryAdjustments(
  storyArc: StoryArc,
  actProgress: Record<number, { consumed: string[]; pending: string[] }>,
  currentChapterIndex: number
): ActBoundaryProposal[] {
  const proposals: ActBoundaryProposal[] = []
  const currentAct = getActForChapter(storyArc, currentChapterIndex)
  if (!currentAct) return proposals

  const chaptersRemaining = currentAct.endChapter - (currentChapterIndex + 1)
  // 只在幕边界附近触发建议
  if (chaptersRemaining > 2 || chaptersRemaining < 0) return proposals

  const progress = actProgress[currentAct.index] ?? {
    consumed: [],
    pending: [...currentAct.mandatoryBeats],
  }

  if (progress.pending.length >= 2) {
    const extension = Math.min(2, progress.pending.length)
    const proposedEnd = currentAct.endChapter + extension
    const nextAct = storyArc.acts.find(a => a.index === currentAct.index + 1)
    const maxEnd = nextAct ? nextAct.endChapter - 1 : storyArc.totalChapters
    if (proposedEnd <= maxEnd) {
      proposals.push({
        actIndex: currentAct.index,
        proposedEndChapter: proposedEnd,
        reason: `第 ${currentAct.index} 幕还剩 ${chaptersRemaining} 章结束，仍有 ${progress.pending.length} 个 mandatory beats 未消费，建议延长 ${extension} 章。`,
      })
    }
  } else if (progress.pending.length === 0 && chaptersRemaining > 0) {
    const reduction = Math.min(chaptersRemaining, 2)
    const proposedEnd = currentAct.endChapter - reduction
    const prevAct = storyArc.acts.find(a => a.index === currentAct.index - 1)
    const minEnd = Math.max(prevAct ? prevAct.endChapter + 1 : 1, currentChapterIndex + 1)
    if (proposedEnd >= minEnd) {
      proposals.push({
        actIndex: currentAct.index,
        proposedEndChapter: proposedEnd,
        reason: `第 ${currentAct.index} 幕还剩 ${chaptersRemaining} 章结束，但所有 mandatory beats 已消费，建议提前 ${reduction} 章结束。`,
      })
    }
  }

  return proposals
}

export interface BoundaryAdjustmentValidation {
  valid: boolean
  reason?: string
}

export function validateActBoundaryAdjustment(
  storyArc: StoryArc,
  actIndex: number,
  proposedEndChapter: number,
  currentChapterIndex: number
): BoundaryAdjustmentValidation {
  const act = storyArc.acts.find(a => a.index === actIndex)
  if (!act) return { valid: false, reason: '幕不存在' }

  if (proposedEndChapter < currentChapterIndex + 1) {
    return { valid: false, reason: '不能将幕边界调整到已写章节之前' }
  }

  const prevAct = storyArc.acts.find(a => a.index === actIndex - 1)
  const nextAct = storyArc.acts.find(a => a.index === actIndex + 1)

  const minEnd = prevAct ? prevAct.endChapter + 1 : 1
  if (proposedEndChapter < minEnd) {
    return { valid: false, reason: '不能与前幕重叠' }
  }

  const maxEnd = nextAct ? nextAct.endChapter - 1 : storyArc.totalChapters
  if (proposedEndChapter > maxEnd) {
    return { valid: false, reason: '不能超出全书总章节数或后幕范围' }
  }

  return { valid: true }
}

/** 单次自动调整的安全上限（章）。 */
const AUTO_ADJUST_MAX_EXTENSION = 3

export interface ApplyActBoundaryAdjustmentResult {
  storyArc: StoryArc
  applied: boolean
  reason?: string
}

/**
 * 自动应用幕边界延长建议，并施加安全约束：
 * - 只延长，不缩短；
 * - 单次最多延长 AUTO_ADJUST_MAX_EXTENSION 章；
 * - 不侵入下一幕；
 * - 使用 validateActBoundaryAdjustment 校验。
 */
export function applyActBoundaryAdjustment(
  storyArc: StoryArc,
  proposal: ActBoundaryProposal,
  currentChapterIndex: number
): ApplyActBoundaryAdjustmentResult {
  const currentAct = storyArc.acts.find(a => a.index === proposal.actIndex)
  if (!currentAct) {
    return { storyArc, applied: false, reason: '幕不存在' }
  }

  if (proposal.proposedEndChapter <= currentAct.endChapter) {
    return { storyArc, applied: false, reason: '自动调整只支持延长幕边界' }
  }

  const rawExtension = proposal.proposedEndChapter - currentAct.endChapter
  const extension = Math.min(rawExtension, AUTO_ADJUST_MAX_EXTENSION)
  const cappedProposedEnd = currentAct.endChapter + extension

  const validation = validateActBoundaryAdjustment(
    storyArc,
    proposal.actIndex,
    cappedProposedEnd,
    currentChapterIndex
  )
  if (!validation.valid) {
    return { storyArc, applied: false, ...(validation.reason ? { reason: validation.reason } : {}) }
  }

  const nextAct = storyArc.acts.find(a => a.index === proposal.actIndex + 1)

  const newActs = storyArc.acts.map(act => {
    if (act.index === proposal.actIndex) {
      return { ...act, endChapter: cappedProposedEnd }
    }
    if (nextAct && act.index === proposal.actIndex + 1) {
      return { ...act, startChapter: cappedProposedEnd + 1 }
    }
    return act
  })

  return {
    storyArc: { ...storyArc, acts: newActs },
    applied: true,
    reason: `已自动将第 ${proposal.actIndex} 幕结束章节从 ${currentAct.endChapter} 调整到 ${cappedProposedEnd}`,
  }
}
