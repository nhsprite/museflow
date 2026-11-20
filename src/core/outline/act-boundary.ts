import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../../graph/state.js'
import { getChapterPlanningConfig } from '../../utils/chapter-planning.js'
import {
  applyActBoundaryAdjustment,
  buildArcStatus,
  formatActBoundaryAdjustmentCommand,
  proposeActExtensionAfterForeshadowAdjudication,
  proposeActBoundaryAdjustments,
  type ActBoundaryProposal,
} from '../../utils/story-arc.js'
import { getBoundaryBlockingForeshadowDetails } from '../../story-memory/foreshadow-policy.js'

function ensureOutlineLength(
  outline: ReducedGraphState['outline'],
  totalChapters: number
): ReducedGraphState['outline'] {
  const next = [...outline]
  for (let i = next.length; i < totalChapters; i++) {
    next.push({ number: i + 1, title: '', description: '' })
  }
  return next
}

function ensureChaptersLength(
  chapters: ReducedGraphState['chapters'],
  totalChapters: number
): ReducedGraphState['chapters'] {
  const next = [...chapters]
  while (next.length < totalChapters) {
    next.push(null)
  }
  return next
}

function synchronizeStateWithStoryArc(
  state: ReducedGraphState,
  updatedStoryArc: NonNullable<ReducedGraphState['storyArc']>
): ReducedGraphState {
  if (updatedStoryArc === state.storyArc) return state

  const updatedTotalChapters = Math.max(state.totalChapters, updatedStoryArc.totalChapters)
  const updatedOutline = ensureOutlineLength(state.outline, updatedTotalChapters)
  const updatedChapters = ensureChaptersLength(state.chapters, updatedTotalChapters)
  const updatedStory =
    updatedTotalChapters === state.story.totalChapters
      ? state.story
      : { ...state.story, totalChapters: updatedTotalChapters, updatedAt: Date.now() }

  return {
    ...state,
    story: updatedStory,
    totalChapters: updatedTotalChapters,
    storyArc: updatedStoryArc,
    outline: updatedOutline,
    chapters: updatedChapters,
  }
}

export interface ApplyAutomaticExtensionResult {
  state: ReducedGraphState
  applied: boolean
  requiresManualResolution: boolean
  reason: string | undefined
  proposal: ActBoundaryProposal | undefined
  requestedExtension: number | undefined
  availableExtensions: number | undefined
}

function applyAutomaticActExtensions(
  state: ReducedGraphState,
  chapterIndex: number,
  proposals: readonly ActBoundaryProposal[],
  stage: string,
  options: { logFailure?: boolean } = {}
): ApplyAutomaticExtensionResult {
  const logFailure = options.logFailure ?? true
  if (!state.storyArc || proposals.length === 0) {
    return {
      state,
      applied: false,
      requiresManualResolution: false,
      reason: undefined,
      proposal: undefined,
      requestedExtension: undefined,
      availableExtensions: undefined,
    }
  }

  let updatedStoryArc = state.storyArc
  const planningConfig = getChapterPlanningConfig(state.genre)
  for (const proposal of proposals) {
    const result = applyActBoundaryAdjustment(
      updatedStoryArc,
      proposal,
      chapterIndex,
      planningConfig
    )
    if (!result.applied) {
      if (logFailure) {
        logger.warn(`[MuseFlow] ${stage}自动延长第 ${proposal.actIndex} 幕失败：${result.reason}`)
        const command = formatActBoundaryAdjustmentCommand(state.story.id, proposal)
        logger.warn(`[MuseFlow] 建议运行：${command}`)
      }
      return {
        state: synchronizeStateWithStoryArc(state, updatedStoryArc),
        applied: false,
        requiresManualResolution: result.requiresManualResolution ?? false,
        reason: result.reason,
        proposal,
        requestedExtension: result.requestedExtension,
        availableExtensions: result.availableExtensions,
      }
    }
    updatedStoryArc = result.storyArc
    logger.info(`[MuseFlow] ${stage}${result.reason}`)
  }

  return {
    state: synchronizeStateWithStoryArc(state, updatedStoryArc),
    applied: true,
    requiresManualResolution: false,
    reason: undefined,
    proposal: undefined,
    requestedExtension: undefined,
    availableExtensions: undefined,
  }
}

export async function autoExtendCurrentActBeforeOutline(
  state: ReducedGraphState,
  chapterIndex: number
): Promise<ReducedGraphState> {
  if (!state.storyArc) return state

  const currentChapterNumber = chapterIndex + 1
  const currentAct = state.storyArc.acts.find(
    (act) => currentChapterNumber >= act.startChapter && currentChapterNumber <= act.endChapter
  )
  if (!currentAct) return state

  const planningConfig = getChapterPlanningConfig(state.genre)

  const extensionProposals = proposeActBoundaryAdjustments(
    state.storyArc,
    state.actProgress,
    chapterIndex,
    state.storyMemory,
    planningConfig.foreshadowMaxFulfillmentsPerChapter
  ).filter(
    (proposal) =>
      proposal.actIndex === currentAct.index && proposal.proposedEndChapter > currentAct.endChapter
  )

  if (extensionProposals.length === 0) return state

  const result = applyAutomaticActExtensions(state, chapterIndex, extensionProposals, '写前')
  if (result.requiresManualResolution) {
    const affectedForeshadowIds = state.storyMemory
      ? getBoundaryBlockingForeshadowDetails(
          state.storyMemory,
          extensionProposals[0]!.proposedEndChapter,
          currentAct.index === state.storyArc.acts.at(-1)?.index
        ).map((foreshadow) => foreshadow.id)
      : []
    const diagnostic = JSON.stringify({
      actIndex: currentAct.index,
      proposedEndChapter: extensionProposals[0]!.proposedEndChapter,
      availableExtensions: result.availableExtensions ?? 0,
      affectedForeshadowIds,
    })
    throw new Error(
      [
        `写前自动延长第 ${currentAct.index} 幕失败：${result.reason ?? '需要人工调整幕边界。'}`,
        `容量诊断：${diagnostic}`,
        `请先运行：${formatActBoundaryAdjustmentCommand(state.story.id, extensionProposals[0]!)}`,
      ].join('\n')
    )
  }
  return result.state
}

export function ensureActCapacityAfterForeshadowAdjudication(
  state: ReducedGraphState,
  chapterIndex: number,
  plannedFulfillmentIds: readonly string[]
): ApplyAutomaticExtensionResult {
  if (!state.storyArc || !state.storyMemory) {
    return {
      state,
      applied: false,
      requiresManualResolution: false,
      reason: undefined,
      proposal: undefined,
      requestedExtension: undefined,
      availableExtensions: undefined,
    }
  }

  const planningConfig = getChapterPlanningConfig(state.genre)
  const proposal = proposeActExtensionAfterForeshadowAdjudication(
    state.storyArc,
    chapterIndex,
    state.storyMemory,
    planningConfig.foreshadowMaxFulfillmentsPerChapter,
    plannedFulfillmentIds
  )
  if (!proposal) {
    return {
      state,
      applied: false,
      requiresManualResolution: false,
      reason: undefined,
      proposal: undefined,
      requestedExtension: undefined,
      availableExtensions: undefined,
    }
  }

  return applyAutomaticActExtensions(state, chapterIndex, [proposal], '伏笔裁决后', {
    logFailure: false,
  })
}

export function buildArcStatusConstraint(
  storyArc: import('../../types/outline.js').StoryArc,
  actProgress: Record<number, { consumed: string[]; pending: string[] }>,
  chapterIndex: number,
  bookClosingPhaseRatio: number,
  verifiedBeatIds: ReadonlySet<string>
): string | undefined {
  const arcStatus = buildArcStatus(
    storyArc,
    actProgress,
    chapterIndex,
    bookClosingPhaseRatio,
    verifiedBeatIds
  )
  const currentAct = arcStatus.currentAct
  if (!currentAct) return undefined

  const chaptersRemaining = currentAct.endChapter - (chapterIndex + 1)
  const pendingCount = arcStatus.beatsPending.length

  if (arcStatus.mandatoryBeatPressure === 'high') {
    return `【幕边界压力 - 高】第 ${currentAct.index} 幕还剩 ${chaptersRemaining} 章结束，仍有 ${pendingCount} 个 mandatory beats 未消费：${arcStatus.beatsPending.join('、')}。本章规划必须优先推进这些节拍中的至少 1 个，且严禁引入无关过渡场景。`
  }
  if (arcStatus.mandatoryBeatPressure === 'medium') {
    return `【幕边界压力 - 中】第 ${currentAct.index} 幕还剩 ${chaptersRemaining} 章结束，仍有 ${pendingCount} 个 mandatory beats 未消费：${arcStatus.beatsPending.join('、')}。本章规划应优先实质消费其中 1 个；持续推迟会把消费义务压缩到幕末零余量章节，届时再无缓冲。`
  }
  return undefined
}
