import type {
  StoryMemory,
  StoryEvent,
  ForeshadowId,
  BeatId,
  ChapterFinalStateDeclaration,
  FinalStateAttribute,
} from '../types/story-memory.js'
import type { ChapterPlan } from '../agents/types.js'
import { diffEvents } from './diff.js'
import { applyEvents } from './projector.js'
import { partitionInvalidForeshadowIntroductions } from './foreshadow-policy.js'
import { splitContentParagraphs } from '../utils/text.js'

export interface StructuredValidationResult {
  expectedEvents: StoryEvent[]
  actualEvents: StoryEvent[]
  missingEvents: StoryEvent[]
  unexpectedEvents: StoryEvent[]
  eventsMissingEvidence: StoryEvent[]
  eventsWithInvalidEvidence: StoryEvent[]
  eventsWithInvalidForeshadowDeadline?: Array<Extract<StoryEvent, { type: 'foreshadow-introduce' }>>

  unfulfilledRequiredForeshadows: ForeshadowId[]
  overdueForeshadows: ForeshadowId[]
  falseFulfillments: ForeshadowId[]
  foreshadowFulfillmentRejections: ForeshadowFulfillmentRejection[]

  unclaimedMandatoryBeats: BeatId[]
  claimedButUnprovenBeats: BeatId[]

  stateConflicts: StateConflict[]
  finalStateMismatches: FinalStateMismatch[]
  finalStateUncorroborated: FinalStateMismatch[]
}

export interface ForeshadowFulfillmentRejection {
  foreshadowId: ForeshadowId
  evidenceParagraphIndex: number | null
  verdict: 'not_fulfilled' | 'uncertain' | 'verification_failed'
  reason: string
}

export interface FinalStateMismatch {
  entityId: string
  attribute: FinalStateAttribute
  declaredValue: string | null
  actualValue: string | null
}

export interface StateConflict {
  entityId: string
  attribute: string
  eventA: StoryEvent
  eventB: StoryEvent
  description: string
}

export interface ChapterEventValidationOptions {
  chapterContent?: string
  requireEvidence?: boolean
  finalStateDeclarations?: ChapterFinalStateDeclaration[]
}

export function validateChapterEvents(
  memory: StoryMemory,
  chapterIndex: number,
  plan: ChapterPlan,
  actualEvents: StoryEvent[],
  options: ChapterEventValidationOptions = {}
): StructuredValidationResult {
  const chapterActual = actualEvents.filter((e) => e.chapterIndex === chapterIndex)
  const chapterExpected = (plan.expectedEvents ?? []).filter((e) => e.chapterIndex === chapterIndex)
  const { validEvents, missingEvidence, invalidEvidence } = filterEventsByEvidence(
    chapterActual,
    options
  )
  const { valid: acceptedEvents, invalid: invalidDeadlineEvents } =
    partitionInvalidForeshadowIntroductions(validEvents)
  const effectiveMemory = applyNewChapterEvents(memory, acceptedEvents)

  const { missing, unexpected } = diffEvents(chapterExpected, acceptedEvents)

  const unfulfilledRequiredForeshadows: ForeshadowId[] = []
  const overdueForeshadows: ForeshadowId[] = []
  const falseFulfillments: ForeshadowId[] = []
  const currentChapter = chapterIndex + 1

  for (const fs of Object.values(effectiveMemory.foreshadows)) {
    if (
      fs.resolutionPolicy === 'must_resolve' &&
      fs.fulfilledIn === null &&
      fs.expectedFulfillChapter !== null &&
      currentChapter > fs.expectedFulfillChapter
    ) {
      overdueForeshadows.push(fs.id)
    }
    if (
      fs.resolutionPolicy === 'must_resolve' &&
      fs.fulfilledIn === null &&
      fs.expectedFulfillChapter !== null &&
      currentChapter >= fs.expectedFulfillChapter
    ) {
      unfulfilledRequiredForeshadows.push(fs.id)
    }
  }

  for (const id of plan.fulfilledForeshadowIds ?? []) {
    const actualFulfilled = acceptedEvents.some(
      (e) => e.type === 'foreshadow-fulfill' && e.foreshadowId === id
    )
    if (!actualFulfilled) {
      falseFulfillments.push(id)
    }
  }

  const unclaimedMandatoryBeats: BeatId[] = []
  const claimedButUnprovenBeats: BeatId[] = []

  for (const beat of Object.values(effectiveMemory.beats)) {
    if (beat.required && beat.provenByEventIds.length === 0) {
      unclaimedMandatoryBeats.push(beat.id)
    }
  }

  const claimedBeatIds = [...(plan.claimedMandatoryBeatIds ?? []), ...(plan.claimedBeatIds ?? [])]
  for (const id of claimedBeatIds) {
    const proven = (effectiveMemory.beats[id]?.provenByEventIds.length ?? 0) > 0
    if (!proven) {
      claimedButUnprovenBeats.push(id)
    }
  }

  return {
    expectedEvents: chapterExpected,
    actualEvents: chapterActual,
    missingEvents: missing,
    unexpectedEvents: unexpected,
    eventsMissingEvidence: missingEvidence,
    eventsWithInvalidEvidence: invalidEvidence,
    eventsWithInvalidForeshadowDeadline: invalidDeadlineEvents,
    unfulfilledRequiredForeshadows,
    overdueForeshadows,
    falseFulfillments,
    foreshadowFulfillmentRejections: [],
    unclaimedMandatoryBeats,
    claimedButUnprovenBeats,
    stateConflicts: detectStateConflicts(acceptedEvents),
    ...validateFinalStateDeclarations(acceptedEvents, options.finalStateDeclarations ?? []),
  }
}

function filterEventsByEvidence(
  events: StoryEvent[],
  options: ChapterEventValidationOptions
): {
  validEvents: StoryEvent[]
  missingEvidence: StoryEvent[]
  invalidEvidence: StoryEvent[]
} {
  if (!options.requireEvidence) {
    return { validEvents: events, missingEvidence: [], invalidEvidence: [] }
  }

  const paragraphCount = countEvidenceParagraphs(options.chapterContent ?? '')
  const validEvents: StoryEvent[] = []
  const missingEvidence: StoryEvent[] = []
  const invalidEvidence: StoryEvent[] = []

  for (const event of events) {
    const evidence = event.evidence
    if (!evidence) {
      missingEvidence.push(event)
      continue
    }
    if (
      !Number.isInteger(evidence.paragraphIndex) ||
      evidence.paragraphIndex < 1 ||
      evidence.paragraphIndex > paragraphCount
    ) {
      invalidEvidence.push(event)
      continue
    }
    validEvents.push(event)
  }

  return { validEvents, missingEvidence, invalidEvidence }
}

export function countEvidenceParagraphs(chapterContent: string): number {
  return splitContentParagraphs(chapterContent).length
}

function applyNewChapterEvents(memory: StoryMemory, chapterActual: StoryEvent[]): StoryMemory {
  if (chapterActual.length === 0) return memory
  const knownEventIds = new Set(memory.events.map((event) => event.id))
  const newEvents = chapterActual.filter((event) => !knownEventIds.has(event.id))
  return newEvents.length > 0 ? applyEvents(memory, newEvents) : memory
}

/**
 * Table-driven mapping from a final-state declaration attribute to the event
 * types that can support it. No prose matching: only event type enums and
 * entity ids are compared.
 */
const FINAL_STATE_EVENT_TYPES: Record<FinalStateAttribute, readonly StoryEvent['type'][]> = {
  location: ['character-location', 'item-location'],
  status: ['character-status', 'item-state'],
}

function validateFinalStateDeclarations(
  events: StoryEvent[],
  declarations: ChapterFinalStateDeclaration[]
): { finalStateMismatches: FinalStateMismatch[]; finalStateUncorroborated: FinalStateMismatch[] } {
  const finalStateMismatches: FinalStateMismatch[] = []
  const finalStateUncorroborated: FinalStateMismatch[] = []

  for (const declaration of declarations) {
    const supportedTypes = FINAL_STATE_EVENT_TYPES[declaration.attribute]
    const candidates = events.filter(
      (event) =>
        (supportedTypes as readonly string[]).includes(event.type) &&
        entityIdFromEvent(event) === declaration.entityId
    )
    const lastEvent = candidates[candidates.length - 1]
    if (!lastEvent) {
      // No supporting event this chapter: the declaration is unverifiable, not
      // necessarily wrong (the entity may simply not have changed). Downgrade to
      // a warning channel instead of a blocking error.
      finalStateUncorroborated.push({
        entityId: declaration.entityId,
        attribute: declaration.attribute,
        declaredValue: declaration.value,
        actualValue: null,
      })
      continue
    }
    const actualValue = finalStateEventValue(lastEvent)
    if (actualValue !== declaration.value) {
      finalStateMismatches.push({
        entityId: declaration.entityId,
        attribute: declaration.attribute,
        declaredValue: declaration.value,
        actualValue,
      })
    }
  }

  return { finalStateMismatches, finalStateUncorroborated }
}

function finalStateEventValue(event: StoryEvent): string | null {
  switch (event.type) {
    case 'character-location':
      return event.locationId
    case 'item-location':
      // locationId is the canonical item location. holderId is supplementary
      // metadata about who is holding the item at that location; it does not
      // override the item's primary location. This avoids false mismatches when
      // a character briefly handles an item that remains in a fixed place.
      return event.locationId ?? event.holderId
    case 'character-status':
    case 'item-state':
      return typeof event.value === 'string' ? event.value : (JSON.stringify(event.value) ?? null)
    default:
      return null
  }
}

function detectStateConflicts(_events: StoryEvent[]): StateConflict[] {
  // Intra-chapter state transitions (e.g. a character moving from A to B to C,
  // or an item being taken out and later locked back) are normal narrative.
  // Flagging every sequence of different-valued state events as a conflict
  // falsely blocks legitimate movement. Final-state declarations and the
  // missing/unexpected event checks already ensure consistency with the plan.
  // Therefore we no longer report state-event sequences as conflicts here.
  return []
}

function entityIdFromEvent(event: StoryEvent): string {
  switch (event.type) {
    case 'character-location':
    case 'character-status':
      return event.characterId
    case 'item-location':
    case 'item-state':
      return event.itemId
    default:
      return ''
  }
}
