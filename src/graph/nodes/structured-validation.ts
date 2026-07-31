import type { ReducedGraphState } from '../state.js'
import type { RuntimeContext } from '../../core/context.js'
import type { StoryEvent } from '../../types/story-memory.js'
import { validateChapterEvents } from '../../story-memory/validator.js'
import { createEmptyStoryMemory, ensureBeatsHaveActIndex } from '../../story-memory/projector.js'
import { readChapterContentForRun } from '../../storage/filesystem/writer.js'
import { verifyForeshadowFulfillments } from '../services/foreshadow-fulfillment/semantic-verifier.js'
import { verifyPlotAdvances } from '../services/plot-advance/semantic-verifier.js'
import { relocateEvidence, type EvidenceRelocationItem } from '../services/evidence-relocation.js'
import { resolveCanonicalForeshadowId } from '../../story-memory/foreshadow-alias.js'
import { logger } from '../../utils/logger.js'
import { isBeatProven } from '../../utils/beat-coverage.js'

export async function validateChapterStructured(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const chapterIndex = state.currentChapterIndex ?? 0
  const plan = state.chapterPlan
  const actualEvents = state.draftChapterEvents ?? []
  const memory = ensureBeatsHaveActIndex(
    state.storyMemory ?? createEmptyStoryMemory(),
    state.storyArc
  )

  if (!plan) {
    return {
      structuredValidationResult: {
        expectedEvents: [],
        actualEvents,
        missingEvents: [],
        unexpectedEvents: [],
        eventsMissingEvidence: [],
        eventsWithInvalidEvidence: [],
        eventsWithInvalidForeshadowDeadline: [],
        unfulfilledRequiredForeshadows: [],
        overdueForeshadows: [],
        falseFulfillments: [],
        foreshadowFulfillmentRejections: [],
        plotAdvanceRejections: [],
        unclaimedMandatoryBeats: [],
        claimedButUnprovenBeats: [],
        stateConflicts: [],
        finalStateMismatches: [],
        finalStateUncorroborated: [],
        autoCompletedEvents: [],
        droppedUnauthorizedPlotAdvanceEvents: [],
      },
    }
  }

  const chapterContent = state.story?.outputDir
    ? await readChapterContentForRun(state.story.outputDir, chapterIndex + 1)
    : null
  const result = validateChapterEvents(memory, chapterIndex, plan, actualEvents, {
    ...(chapterContent !== null
      ? { chapterContent, requireEvidence: true }
      : { requireEvidence: false }),
    finalStateDeclarations: state.chapterFinalStateDeclarations ?? [],
    storyArc: state.storyArc,
  })

  // 未授权 plot-advance 分流：正文级语义验证代替 plan 授权硬拒。
  // 通过 = 正文真实推进（即使未认领/被撤销，也按权威层级接受为进展）；
  // 不过 = 丢弃并降级 warning，不再阻塞章节。
  // 其余类型的未授权事件（location/status/foreshadow 等）维持硬拒，防止编造未规划状态。
  const unexpectedPlotAdvanceEvents = result.unexpectedEvents.filter(
    (event): event is Extract<StoryEvent, { type: 'plot-advance' }> => event.type === 'plot-advance'
  )
  const unexpectedNonPlotEvents = result.unexpectedEvents.filter(
    (event) => event.type !== 'plot-advance'
  )

  const structurallyRejectedEventIds = new Set(
    [
      ...unexpectedNonPlotEvents,
      ...result.eventsMissingEvidence,
      ...result.eventsWithInvalidEvidence,
    ].map((event) => event.id)
  )
  const fulfillmentCandidates = result.actualEvents.filter(
    (event): event is Extract<typeof event, { type: 'foreshadow-fulfill' }> =>
      event.type === 'foreshadow-fulfill' && !structurallyRejectedEventIds.has(event.id)
  )
  const semanticRejections = await verifyForeshadowFulfillments({
    provider: context.provider,
    memory,
    chapterContent: chapterContent ?? '',
    candidates: fulfillmentCandidates,
  })
  const plotAdvanceCandidates = result.actualEvents.filter(
    (event): event is Extract<typeof event, { type: 'plot-advance' }> =>
      event.type === 'plot-advance' && !structurallyRejectedEventIds.has(event.id)
  )
  const plotAdvanceRejections = await verifyPlotAdvances({
    provider: context.provider,
    memory,
    chapterContent: chapterContent ?? '',
    candidates: plotAdvanceCandidates,
  })

  const rejectedEventIds = new Set(plotAdvanceRejections.map((rejection) => rejection.eventId))
  const droppedUnauthorizedPlotAdvanceEvents = unexpectedPlotAdvanceEvents.filter((event) =>
    rejectedEventIds.has(event.id)
  )
  const acceptedUnauthorizedPlotAdvanceEvents = unexpectedPlotAdvanceEvents.filter(
    (event) => !rejectedEventIds.has(event.id)
  )
  const droppedEventIds = new Set(droppedUnauthorizedPlotAdvanceEvents.map((event) => event.id))
  // 丢弃项不进 beat_unproven 错误通道（那是 claimed 节拍的反馈路径），改走 warning。
  const claimedPlotAdvanceRejections = plotAdvanceRejections.filter(
    (rejection) => !droppedEventIds.has(rejection.eventId)
  )

  // 证据重锚定：STORY_EVENTS 先于正文输出，@pN 锚点本质是对未写出段落的预测。
  // claimed 事件的语义驳回可能只是锚点指错而正文已在别处落实命题——先在全章范围内
  // 定位能实质呈现命题的段落并修正证据；只有找不到时才维持驳回（此时驳回才可靠地
  // 意味着正文缺失该场景，需要走 draft/大纲层修复）。
  const fsEventIdByRejectionId = new Map<string, string>()
  const relocationItems: EvidenceRelocationItem[] = []
  if (chapterContent && chapterContent.trim().length > 0) {
    for (const rejection of claimedPlotAdvanceRejections) {
      if (rejection.verdict !== 'not_proven' && rejection.verdict !== 'uncertain') continue
      relocationItems.push({
        key: rejection.eventId,
        claim: memory.beats[rejection.beatId]?.description ?? rejection.beatId,
        rejectedParagraphIndex: rejection.evidenceParagraphIndex ?? 0,
        rejectionReason: rejection.reason,
      })
    }
    for (const rejection of semanticRejections) {
      if (rejection.verdict !== 'not_fulfilled' && rejection.verdict !== 'uncertain') continue
      const event = fulfillmentCandidates.find(
        (candidate) =>
          resolveCanonicalForeshadowId(memory, candidate.foreshadowId) === rejection.foreshadowId
      )
      if (!event) continue
      const planted = memory.foreshadows[rejection.foreshadowId]
      const claim = planted
        ? [planted.text, planted.resolutionQuestion, planted.fulfillmentCriteria]
            .filter((part): part is string => typeof part === 'string' && part.length > 0)
            .join('；')
        : rejection.foreshadowId
      fsEventIdByRejectionId.set(rejection.foreshadowId, event.id)
      relocationItems.push({
        key: event.id,
        claim,
        rejectedParagraphIndex: rejection.evidenceParagraphIndex ?? 0,
        rejectionReason: rejection.reason,
      })
    }
  }
  const relocatedEvidence = await relocateEvidence({
    provider: context.provider,
    chapterContent: chapterContent ?? '',
    items: relocationItems,
  })
  if (relocatedEvidence.size > 0) {
    const originalIndexByEventId = new Map(
      result.actualEvents.map((event) => [event.id, event.evidence?.paragraphIndex ?? null])
    )
    for (const [eventId, newIndex] of relocatedEvidence) {
      logger.info(
        `[MuseFlow] 第 ${chapterIndex + 1} 章事件 ${eventId} 的证据段落由 p${originalIndexByEventId.get(eventId) ?? '?'} 重锚定为 p${newIndex}（命题已在正文该段落实质呈现）`
      )
    }
  }
  const survivingPlotAdvanceRejections = claimedPlotAdvanceRejections.filter(
    (rejection) => !relocatedEvidence.has(rejection.eventId)
  )
  const survivingSemanticRejections = semanticRejections.filter((rejection) => {
    const eventId = fsEventIdByRejectionId.get(rejection.foreshadowId)
    return eventId === undefined || !relocatedEvidence.has(eventId)
  })
  const falseFulfillments = [
    ...new Set([
      ...result.falseFulfillments,
      ...survivingSemanticRejections.map((rejection) => rejection.foreshadowId),
    ]),
  ]

  if (acceptedUnauthorizedPlotAdvanceEvents.length > 0) {
    logger.info(
      `[MuseFlow] 第 ${chapterIndex + 1} 章接受 ${acceptedUnauthorizedPlotAdvanceEvents.length} 条未认领但经语义验证证实的节拍推进：${acceptedUnauthorizedPlotAdvanceEvents.map((event) => event.beatId).join('、')}`
    )
  }
  if (droppedUnauthorizedPlotAdvanceEvents.length > 0) {
    logger.warn(
      `[MuseFlow] 第 ${chapterIndex + 1} 章丢弃 ${droppedUnauthorizedPlotAdvanceEvents.length} 条未授权且未通过语义验证的节拍推进事件：${droppedUnauthorizedPlotAdvanceEvents.map((event) => `${event.id}（${event.beatId}）`).join('、')}`
    )
  }

  const rejectedBeatIds = new Set(
    survivingPlotAdvanceRejections.map((rejection) => rejection.beatId)
  )
  const claimedBeatIds = [...(plan.claimedMandatoryBeatIds ?? []), ...(plan.claimedBeatIds ?? [])]
  const claimedButUnprovenBeats = [
    ...new Set([
      ...result.claimedButUnprovenBeats,
      ...claimedBeatIds.filter(
        (beatId) => rejectedBeatIds.has(beatId) && !isBeatProven(state.storyArc, memory, beatId)
      ),
    ]),
  ]

  if (result.autoCompletedEvents.length > 0) {
    logger.info(
      `[MuseFlow] 第 ${chapterIndex + 1} 章依据章末终态声明补发 ${result.autoCompletedEvents.length} 条归位/状态事件：`
    )
    for (const event of result.autoCompletedEvents) {
      logger.info(`  - ${formatAutoCompletedEvent(event)}`)
    }
  }

  return {
    structuredValidationResult: {
      ...result,
      unexpectedEvents: unexpectedNonPlotEvents,
      droppedUnauthorizedPlotAdvanceEvents,
      falseFulfillments,
      foreshadowFulfillmentRejections: survivingSemanticRejections,
      claimedButUnprovenBeats,
      plotAdvanceRejections: survivingPlotAdvanceRejections,
    },
    // 补全事件与被接受的未授权 plot-advance 随 draftChapterEvents 写回，定稿时写入 StoryMemory；
    // 被丢弃的未授权事件在此剔除（下一轮校验若 writer 重发，会按同一闸门重新裁决）。
    // 经重锚定的事件携带修正后的证据段落序号写回。
    draftChapterEvents: result.actualEvents
      .filter((event) => !droppedEventIds.has(event.id))
      .map((event) => {
        const relocatedIndex = relocatedEvidence.get(event.id)
        return relocatedIndex !== undefined
          ? { ...event, evidence: { paragraphIndex: relocatedIndex } }
          : event
      }),
  }
}

function formatAutoCompletedEvent(event: StoryEvent): string {
  switch (event.type) {
    case 'character-location':
      return `${event.characterId} 位置 => ${event.locationId ?? '（无）'}`
    case 'character-status':
      return `${event.characterId} 状态(${event.attribute}) => ${String(event.value)}`
    case 'item-location':
      return `${event.itemId} 位置 => ${event.locationId ?? event.holderId ?? '（无）'}`
    case 'item-state':
      return `${event.itemId} 状态(${event.attribute}) => ${String(event.value)}`
    default:
      return `${event.type}（${event.id}）`
  }
}
