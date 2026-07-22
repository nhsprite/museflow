import type { ReducedGraphState } from '../state.js'
import type { RuntimeContext } from '../../core/context.js'
import type { StoryEvent } from '../../types/story-memory.js'
import { validateChapterEvents } from '../../story-memory/validator.js'
import { createEmptyStoryMemory, ensureBeatsHaveActIndex } from '../../story-memory/projector.js'
import { readChapterContentForRun } from '../../storage/filesystem/writer.js'
import { verifyForeshadowFulfillments } from '../services/foreshadow-fulfillment/semantic-verifier.js'
import { verifyPlotAdvances } from '../services/plot-advance/semantic-verifier.js'
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
  const falseFulfillments = [
    ...new Set([
      ...result.falseFulfillments,
      ...semanticRejections.map((rejection) => rejection.foreshadowId),
    ]),
  ]
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

  const rejectedBeatIds = new Set(claimedPlotAdvanceRejections.map((rejection) => rejection.beatId))
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
      foreshadowFulfillmentRejections: semanticRejections,
      claimedButUnprovenBeats,
      plotAdvanceRejections: claimedPlotAdvanceRejections,
    },
    // 补全事件与被接受的未授权 plot-advance 随 draftChapterEvents 写回，定稿时写入 StoryMemory；
    // 被丢弃的未授权事件在此剔除（下一轮校验若 writer 重发，会按同一闸门重新裁决）。
    draftChapterEvents: result.actualEvents.filter((event) => !droppedEventIds.has(event.id)),
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
