import type { StoryMemory, StoryEvent, ForeshadowId, BeatId } from '../types/story-memory.js'
import type { ChapterPlan } from '../agents/types.js'
import { diffEvents } from './diff.js'
import { applyEvents } from './projector.js'

export interface StructuredValidationResult {
  expectedEvents: StoryEvent[]
  actualEvents: StoryEvent[]
  missingEvents: StoryEvent[]
  unexpectedEvents: StoryEvent[]
  eventsMissingEvidence: StoryEvent[]
  eventsWithInvalidEvidence: StoryEvent[]

  unfulfilledRequiredForeshadows: ForeshadowId[]
  overdueForeshadows: ForeshadowId[]
  falseFulfillments: ForeshadowId[]

  unclaimedMandatoryBeats: BeatId[]
  claimedButUnprovenBeats: BeatId[]

  stateConflicts: StateConflict[]
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
  const effectiveMemory = applyNewChapterEvents(memory, validEvents)

  const { missing, unexpected } = diffEvents(chapterExpected, validEvents)

  const unfulfilledRequiredForeshadows: ForeshadowId[] = []
  const overdueForeshadows: ForeshadowId[] = []
  const falseFulfillments: ForeshadowId[] = []

  for (const fs of Object.values(effectiveMemory.foreshadows)) {
    if (
      fs.required &&
      !fs.fulfilledIn &&
      fs.expectedFulfillChapter &&
      chapterIndex > fs.expectedFulfillChapter
    ) {
      overdueForeshadows.push(fs.id)
    }
    if (
      fs.required &&
      !fs.fulfilledIn &&
      fs.expectedFulfillChapter &&
      chapterIndex >= fs.expectedFulfillChapter
    ) {
      unfulfilledRequiredForeshadows.push(fs.id)
    }
  }

  for (const id of plan.fulfilledForeshadowIds ?? []) {
    const actualFulfilled = validEvents.some(
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
    unfulfilledRequiredForeshadows,
    overdueForeshadows,
    falseFulfillments,
    unclaimedMandatoryBeats,
    claimedButUnprovenBeats,
    stateConflicts: detectStateConflicts(validEvents),
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
  return chapterContent
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0 && !/^#{1,6}\s/.test(paragraph)).length
}

function applyNewChapterEvents(memory: StoryMemory, chapterActual: StoryEvent[]): StoryMemory {
  if (chapterActual.length === 0) return memory
  const knownEventIds = new Set(memory.events.map((event) => event.id))
  const newEvents = chapterActual.filter((event) => !knownEventIds.has(event.id))
  return newEvents.length > 0 ? applyEvents(memory, newEvents) : memory
}

function detectStateConflicts(events: StoryEvent[]): StateConflict[] {
  const conflicts: StateConflict[] = []
  const lastEventByKey = new Map<string, StoryEvent>()

  for (const event of events) {
    if (!isStateEvent(event)) continue
    const key = eventKey(event)
    const previous = lastEventByKey.get(key)
    if (previous && !eventsEqual(event, previous)) {
      conflicts.push({
        entityId: entityIdFromEvent(event),
        attribute: attributeFromEvent(event),
        eventA: previous,
        eventB: event,
        description: `Conflicting ${event.type} events in same chapter`,
      })
    }
    lastEventByKey.set(key, event)
  }

  return conflicts
}

function isStateEvent(event: StoryEvent): boolean {
  return (
    event.type === 'character-location' ||
    event.type === 'character-status' ||
    event.type === 'item-location' ||
    event.type === 'item-state'
  )
}

function eventKey(event: StoryEvent): string {
  switch (event.type) {
    case 'character-location':
      return `${event.type}:${event.characterId}`
    case 'character-status':
      return `${event.type}:${event.characterId}:${event.attribute}`
    case 'item-location':
      return `${event.type}:${event.itemId}`
    case 'item-state':
      return `${event.type}:${event.itemId}:${event.attribute}`
    default:
      return `${event.type}:${event.id}`
  }
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

function attributeFromEvent(event: StoryEvent): string {
  switch (event.type) {
    case 'character-status':
      return event.attribute
    case 'item-state':
      return event.attribute
    default:
      return 'location'
  }
}

function eventsEqual(a: StoryEvent, b: StoryEvent): boolean {
  if (a.type !== b.type) return false

  switch (a.type) {
    case 'character-location':
      return (
        b.type === 'character-location' &&
        a.characterId === b.characterId &&
        a.locationId === b.locationId
      )
    case 'character-status':
      return (
        b.type === 'character-status' &&
        a.characterId === b.characterId &&
        a.attribute === b.attribute &&
        JSON.stringify(a.value) === JSON.stringify(b.value)
      )
    case 'item-location':
      return (
        b.type === 'item-location' &&
        a.itemId === b.itemId &&
        a.holderId === b.holderId &&
        a.locationId === b.locationId
      )
    case 'item-state':
      return (
        b.type === 'item-state' &&
        a.itemId === b.itemId &&
        a.attribute === b.attribute &&
        JSON.stringify(a.value) === JSON.stringify(b.value)
      )
    default:
      return false
  }
}
