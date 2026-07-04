import type { ActArc, KeyBeat, StoryArc } from '../types/outline.js'
import type { ModelProvider, Message, JsonSchema } from '../model/provider.js'
import { logger } from './logger.js'

export function getActForChapter(
  storyArc: StoryArc | null | undefined,
  chapterIndex: number
): ActArc | undefined {
  if (!storyArc) return undefined
  const chapterNumber = chapterIndex + 1
  return storyArc.acts.find((a) => chapterNumber >= a.startChapter && chapterNumber <= a.endChapter)
}

export function isClosingPhase(
  totalChapters: number,
  currentChapterIndex: number,
  ratio = 0.15
): boolean {
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
    (kb) => kb.deadlineAct < currentActIndex && !progress.consumed.includes(kb.beat)
  )
  const upcomingKeyBeats = storyArc.keyBeats.filter(
    (kb) => kb.deadlineAct === currentActIndex && !progress.consumed.includes(kb.beat)
  )

  let riskLevel: ArcStatus['riskLevel'] = 'low'
  if (
    overdueKeyBeats.length > 0 ||
    (currentAct && beatsPending.length > currentAct.endChapter - (currentChapterIndex + 1))
  ) {
    riskLevel = 'high'
  } else if (
    upcomingKeyBeats.length > 0 ||
    (currentAct &&
      beatsPending.length > 0 &&
      currentAct.endChapter - (currentChapterIndex + 1) <= 2)
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
    (kb) => !pendingBeats.includes(kb.beat) && kb.deadlineAct <= currentActIndex
  )

  const parts: string[] = [
    `【全书收尾阶段】本书仅剩 ${chaptersRemaining} 章结束。`,
    '禁止引入新的主要支线、新角色或新的未解悬念。',
  ]
  if (pendingBeats.length > 0) {
    parts.push(`必须优先消费以下仍未消费的 mandatory beats：${pendingBeats.join('、')}。`)
  }
  if (pendingKeyBeats.length > 0) {
    parts.push(
      `必须回收以下逾期/即将到期的关键节拍：${pendingKeyBeats.map((k) => k.beat).join('、')}。`
    )
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
    proposals.push({
      actIndex: currentAct.index,
      proposedEndChapter: proposedEnd,
      reason: `第 ${currentAct.index} 幕还剩 ${chaptersRemaining} 章结束，仍有 ${progress.pending.length} 个 mandatory beats 未消费，建议延长 ${extension} 章。`,
    })
  } else if (progress.pending.length === 0 && chaptersRemaining > 0) {
    const reduction = Math.min(chaptersRemaining, 2)
    const proposedEnd = currentAct.endChapter - reduction
    const prevAct = storyArc.acts.find((a) => a.index === currentAct.index - 1)
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
  const act = storyArc.acts.find((a) => a.index === actIndex)
  if (!act) return { valid: false, reason: '幕不存在' }

  if (proposedEndChapter < currentChapterIndex + 1) {
    return { valid: false, reason: '不能将幕边界调整到已写章节之前' }
  }

  const prevAct = storyArc.acts.find((a) => a.index === actIndex - 1)
  const nextAct = storyArc.acts.find((a) => a.index === actIndex + 1)

  const minEnd = prevAct ? prevAct.endChapter + 1 : 1
  if (proposedEndChapter < minEnd) {
    return { valid: false, reason: '不能与前幕重叠' }
  }

  const isExtension = proposedEndChapter > act.endChapter
  if (!isExtension) {
    const maxEnd = nextAct ? nextAct.endChapter - 1 : storyArc.totalChapters
    if (proposedEndChapter > maxEnd) {
      return { valid: false, reason: '不能超出全书总章节数或后幕范围' }
    }
  }

  return { valid: true }
}

/** 单次自动调整的安全上限（章）。 */
const AUTO_ADJUST_MAX_EXTENSION = 3
/** 单幕累计自动延长上限（章）。超过后必须人工处理或重写消费 pending beats。 */
const AUTO_ADJUST_MAX_CUMULATIVE_EXTENSION = 3
/** 全书累计自动延长上限比例。防止多个幕分别延长导致整本书失控膨胀。 */
const AUTO_ADJUST_MAX_GLOBAL_EXTENSION_RATIO = 0.15

export interface ApplyActBoundaryAdjustmentResult {
  storyArc: StoryArc
  applied: boolean
  reason?: string
  requiresManualResolution?: boolean
}

function shiftActRange(act: ActArc, delta: number): ActArc {
  if (delta === 0) return act

  const shifted: ActArc = {
    ...act,
    startChapter: act.startChapter + delta,
    endChapter: act.endChapter + delta,
  }

  if (act.autoBoundaryAdjustment) {
    shifted.autoBoundaryAdjustment = {
      ...act.autoBoundaryAdjustment,
      originalEndChapter: act.autoBoundaryAdjustment.originalEndChapter + delta,
    }
  }

  return shifted
}

export function applyActBoundaryShift(
  storyArc: StoryArc,
  actIndex: number,
  proposedEndChapter: number
): StoryArc {
  const currentAct = storyArc.acts.find((a) => a.index === actIndex)
  if (!currentAct) return storyArc

  const delta = proposedEndChapter - currentAct.endChapter
  if (delta === 0) return storyArc

  const nextAct = storyArc.acts.find((a) => a.index === actIndex + 1)
  const newActs = storyArc.acts.map((act) => {
    if (act.index === actIndex) {
      return { ...act, endChapter: proposedEndChapter }
    }
    if (delta > 0 && act.index > actIndex) {
      return shiftActRange(act, delta)
    }
    if (delta < 0 && nextAct && act.index === actIndex + 1) {
      return { ...act, startChapter: proposedEndChapter + 1 }
    }
    return act
  })

  return {
    ...storyArc,
    totalChapters: delta > 0 ? storyArc.totalChapters + delta : storyArc.totalChapters,
    acts: newActs,
  }
}

/**
 * 自动应用幕边界调整建议，并施加安全约束：
 * - 支持延长与缩短；
 * - 单次调整幅度不超过 AUTO_ADJUST_MAX_EXTENSION 章；
 * - 不侵入下一幕，也不能把边界调到已写章节之前；
 * - 使用 validateActBoundaryAdjustment 校验。
 */
export function applyActBoundaryAdjustment(
  storyArc: StoryArc,
  proposal: ActBoundaryProposal,
  currentChapterIndex: number
): ApplyActBoundaryAdjustmentResult {
  const currentAct = storyArc.acts.find((a) => a.index === proposal.actIndex)
  if (!currentAct) {
    return { storyArc, applied: false, reason: '幕不存在' }
  }

  if (proposal.proposedEndChapter === currentAct.endChapter) {
    return { storyArc, applied: false, reason: '调整目标与当前边界相同' }
  }

  const isExtension = proposal.proposedEndChapter > currentAct.endChapter
  const rawDelta = Math.abs(proposal.proposedEndChapter - currentAct.endChapter)
  const originalEndChapter =
    currentAct.autoBoundaryAdjustment?.originalEndChapter ?? currentAct.endChapter
  const alreadyExtendedBy = Math.max(
    currentAct.autoBoundaryAdjustment?.totalExtendedChapters ?? 0,
    currentAct.autoBoundaryAdjustment ? currentAct.endChapter - originalEndChapter : 0,
    0
  )
  const remainingCumulativeExtension = AUTO_ADJUST_MAX_CUMULATIVE_EXTENSION - alreadyExtendedBy
  const originalTotalChapters =
    storyArc.autoBoundaryAdjustment?.originalTotalChapters ?? storyArc.totalChapters
  const globalExtensionCap = Math.max(
    AUTO_ADJUST_MAX_EXTENSION,
    Math.ceil(originalTotalChapters * AUTO_ADJUST_MAX_GLOBAL_EXTENSION_RATIO)
  )
  const alreadyGloballyExtendedBy = Math.max(
    storyArc.autoBoundaryAdjustment?.totalExtendedChapters ?? 0,
    storyArc.autoBoundaryAdjustment ? storyArc.totalChapters - originalTotalChapters : 0,
    0
  )
  const remainingGlobalExtension = globalExtensionCap - alreadyGloballyExtendedBy

  if (isExtension && remainingCumulativeExtension <= 0) {
    return {
      storyArc,
      applied: false,
      requiresManualResolution: true,
      reason: `第 ${proposal.actIndex} 幕已达到累计自动延长上限（${AUTO_ADJUST_MAX_CUMULATIVE_EXTENSION} 章），需要重写当前章节消费 pending beats，或人工调整大纲/幕边界。`,
    }
  }

  if (isExtension && remainingGlobalExtension <= 0) {
    return {
      storyArc,
      applied: false,
      requiresManualResolution: true,
      reason: `全书累计自动延长上限（${globalExtensionCap} 章）已用尽，需要重写当前章节消费 pending beats，或进行全书结构再平衡。`,
    }
  }

  const cappedDelta = isExtension
    ? Math.min(
        rawDelta,
        AUTO_ADJUST_MAX_EXTENSION,
        remainingCumulativeExtension,
        remainingGlobalExtension
      )
    : Math.min(rawDelta, AUTO_ADJUST_MAX_EXTENSION)
  const cappedProposedEnd = isExtension
    ? currentAct.endChapter + cappedDelta
    : currentAct.endChapter - cappedDelta

  const validation = validateActBoundaryAdjustment(
    storyArc,
    proposal.actIndex,
    cappedProposedEnd,
    currentChapterIndex
  )
  if (!validation.valid) {
    return { storyArc, applied: false, ...(validation.reason ? { reason: validation.reason } : {}) }
  }

  const shiftedStoryArc = applyActBoundaryShift(storyArc, proposal.actIndex, cappedProposedEnd)
  const newActs = shiftedStoryArc.acts.map((act) => {
    if (act.index !== proposal.actIndex) return act

    const totalExtendedChapters = Math.max(0, cappedProposedEnd - originalEndChapter)
    if (totalExtendedChapters > 0) {
      return {
        ...act,
        autoBoundaryAdjustment: {
          originalEndChapter,
          totalExtendedChapters,
        },
      }
    }

    const actWithoutAdjustment = { ...act }
    delete actWithoutAdjustment.autoBoundaryAdjustment
    return actWithoutAdjustment
  })

  const nextStoryArc: StoryArc = { ...shiftedStoryArc, acts: newActs }
  if (isExtension) {
    nextStoryArc.autoBoundaryAdjustment = {
      originalTotalChapters,
      totalExtendedChapters: alreadyGloballyExtendedBy + cappedDelta,
    }
  } else if (storyArc.autoBoundaryAdjustment) {
    const totalExtendedChapters = Math.max(0, shiftedStoryArc.totalChapters - originalTotalChapters)
    if (totalExtendedChapters > 0) {
      nextStoryArc.autoBoundaryAdjustment = {
        originalTotalChapters,
        totalExtendedChapters,
      }
    }
  }

  return {
    storyArc: nextStoryArc,
    applied: true,
    reason: `已自动将第 ${proposal.actIndex} 幕结束章节从 ${currentAct.endChapter} 调整到 ${cappedProposedEnd}`,
  }
}

async function requestCoveredBeats(
  provider: ModelProvider,
  contextText: string,
  beats: string[],
  contextLabel: string
): Promise<string[]> {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      coveredBeats: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['coveredBeats'],
  }

  const messages: Message[] = [
    {
      role: 'system',
      content:
        '你是一位小说结构分析师。请严格根据提供的章节内容，判断给定的 mandatory beats 中哪些已经确实发生或确立。只返回确实发生的 beat 原文，不得改写、不得推断未发生的内容。',
    },
    {
      role: 'user',
      content: `【${contextLabel}】\n${contextText.slice(0, 12000)}\n\n【待判断的 beats】\n${beats.map((beat, i) => `${i + 1}. ${beat}`).join('\n')}\n\n请输出 JSON：{"coveredBeats": ["已发生的 beat 原文", ...]}。只包含上述列表中确实发生的项。`,
    },
  ]

  try {
    const response = provider.chatStructured
      ? await provider.chatStructured<{ coveredBeats: unknown[] }>(messages, schema, 0.1)
      : (JSON.parse(
          (await provider.chat(messages, 0.1)).replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
        ) as { coveredBeats: unknown[] })

    const raw = Array.isArray(response.coveredBeats) ? response.coveredBeats : []
    const matched: string[] = []
    const allowed = new Set(beats)
    for (const item of raw) {
      if (typeof item !== 'string') continue
      const candidate = item.trim()
      if (allowed.has(candidate) && !matched.includes(candidate)) {
        matched.push(candidate)
      }
    }
    return matched
  } catch (err) {
    logger.debug(
      `[MuseFlow] mandatory beat 覆盖判定失败: ${err instanceof Error ? err.message : String(err)}`
    )
    return []
  }
}

/**
 * 使用模型根据单章正文判断哪些 mandatory beats 已被覆盖。
 * 用于补救 SummaryAgent 不返回 claimedBeats 原句的情况。
 */
export async function judgeMandatoryBeatCoverage(
  provider: ModelProvider,
  chapterContent: string,
  beats: string[]
): Promise<string[]> {
  if (beats.length === 0 || chapterContent.trim().length === 0) {
    return []
  }
  return requestCoveredBeats(provider, chapterContent, beats, '章节正文')
}

/**
 * 使用模型根据已写章节摘要，判断当前幕 pending 的 mandatory beats 中哪些已被覆盖。
 * 用于修复历史章节 verifiedBeats 为 narrative 摘要导致漏记的问题。
 */
export async function judgeMandatoryBeatCoverageAcrossAct(
  provider: ModelProvider,
  act: ActArc,
  pendingBeats: string[],
  chapterSummaries: string[],
  outlineDescriptions: string[]
): Promise<string[]> {
  if (pendingBeats.length === 0) return []

  const actChapterCount = act.endChapter - act.startChapter + 1
  const availableSummaries = chapterSummaries.slice(
    act.startChapter - 1,
    act.startChapter - 1 + actChapterCount
  )
  const availableDescriptions = outlineDescriptions.slice(
    act.startChapter - 1,
    act.startChapter - 1 + actChapterCount
  )

  const contextParts: string[] = []
  for (let i = 0; i < actChapterCount; i++) {
    const summary = availableSummaries[i]
    const description = availableDescriptions[i]
    if (!summary && !description) continue
    const lines: string[] = []
    if (description) lines.push(`大纲：${description}`)
    if (summary) lines.push(`摘要：${summary}`)
    contextParts.push(`第 ${act.startChapter + i} 章\n${lines.join('\n')}`)
  }

  if (contextParts.length === 0) return []

  return requestCoveredBeats(
    provider,
    contextParts.join('\n\n'),
    pendingBeats,
    '当前幕已写章节的大纲与摘要'
  )
}
