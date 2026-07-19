import type { ReducedGraphState } from '../state.js'
import type { RuntimeContext } from '../../core/context.js'
import { validateChapterEvents } from '../../story-memory/validator.js'
import { createEmptyStoryMemory, ensureBeatsHaveActIndex } from '../../story-memory/projector.js'
import { readChapterContentForRun } from '../../storage/filesystem/writer.js'
import { verifyForeshadowFulfillments } from '../services/foreshadow-fulfillment/semantic-verifier.js'
import { verifyPlotAdvances } from '../services/plot-advance/semantic-verifier.js'

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
  })

  const structurallyRejectedEventIds = new Set(
    [
      ...result.unexpectedEvents,
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
  const rejectedBeatIds = new Set(plotAdvanceRejections.map((rejection) => rejection.beatId))
  const claimedBeatIds = [...(plan.claimedMandatoryBeatIds ?? []), ...(plan.claimedBeatIds ?? [])]
  const claimedButUnprovenBeats = [
    ...new Set([
      ...result.claimedButUnprovenBeats,
      ...claimedBeatIds.filter(
        (beatId) =>
          rejectedBeatIds.has(beatId) && (memory.beats[beatId]?.provenByEventIds.length ?? 0) === 0
      ),
    ]),
  ]

  return {
    structuredValidationResult: {
      ...result,
      falseFulfillments,
      foreshadowFulfillmentRejections: semanticRejections,
      claimedButUnprovenBeats,
      plotAdvanceRejections,
    },
  }
}
