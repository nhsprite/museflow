import type { ReducedGraphState } from '../state.js'
import type { RuntimeContext } from '../../core/context.js'
import { validateChapterEvents } from '../../story-memory/validator.js'
import { createEmptyStoryMemory } from '../../story-memory/projector.js'
import { readChapterContentForRun } from '../../storage/filesystem/writer.js'

export async function validateChapterStructured(
  _context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const chapterIndex = state.currentChapterIndex ?? 0
  const plan = state.chapterPlan
  const actualEvents = state.draftChapterEvents ?? []
  const memory = state.storyMemory ?? createEmptyStoryMemory()

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
        unclaimedMandatoryBeats: [],
        claimedButUnprovenBeats: [],
        stateConflicts: [],
      },
    }
  }

  const chapterContent = state.story?.outputDir
    ? await readChapterContentForRun(state.story.outputDir, chapterIndex + 1)
    : null
  const result = validateChapterEvents(
    memory,
    chapterIndex,
    plan,
    actualEvents,
    chapterContent !== null ? { chapterContent, requireEvidence: true } : { requireEvidence: false }
  )
  return { structuredValidationResult: result }
}
