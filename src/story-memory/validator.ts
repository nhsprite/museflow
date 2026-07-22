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
import { getCanonicalForeshadows, resolveCanonicalForeshadowId } from './foreshadow-alias.js'
import { generateId } from '../utils/id.js'
import type { StoryArc } from '../types/outline.js'
import { getCoveredMandatoryBeatId, isBeatProven } from '../utils/beat-coverage.js'

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
  plotAdvanceRejections: PlotAdvanceRejection[]

  unclaimedMandatoryBeats: BeatId[]
  claimedButUnprovenBeats: BeatId[]

  stateConflicts: StateConflict[]
  finalStateMismatches: FinalStateMismatch[]
  finalStateUncorroborated: FinalStateMismatch[]
  /**
   * 系统依据章末终态声明补发的「返回原点」事件（source 为 final-state-completion）。
   * 每轮校验都会先剔除旧补全事件再按最新声明重算，因此该列表始终只含本轮新补事件。
   */
  autoCompletedEvents: StoryEvent[]
  /**
   * 未由章节规划授权、且未通过正文语义验证而被丢弃的 plot-advance 事件（warning 级，不阻塞）。
   * 通过语义验证的未授权 plot-advance 保留在 actualEvents 中，作为真实进展被定稿消费。
   * 由 structured-validation 节点在语义验证后填充；纯 diff 校验阶段恒为空。
   */
  droppedUnauthorizedPlotAdvanceEvents: Array<Extract<StoryEvent, { type: 'plot-advance' }>>
}

export interface ForeshadowFulfillmentRejection {
  foreshadowId: ForeshadowId
  evidenceParagraphIndex: number | null
  verdict: 'not_fulfilled' | 'uncertain' | 'verification_failed'
  reason: string
}

export interface PlotAdvanceRejection {
  eventId: string
  beatId: BeatId
  evidenceParagraphIndex: number | null
  verdict: 'not_proven' | 'uncertain' | 'verification_failed'
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
  storyArc?: StoryArc | null
}

export function validateChapterEvents(
  memory: StoryMemory,
  chapterIndex: number,
  plan: ChapterPlan,
  actualEvents: StoryEvent[],
  options: ChapterEventValidationOptions = {}
): StructuredValidationResult {
  // 补全事件由系统按声明机械生成，每轮校验先剔除再重算，保证幂等：
  // 既不污染 missing/unexpected 对比，也不与后续轮次变更的声明相互打架。
  const chapterActual = actualEvents.filter(
    (e) => e.chapterIndex === chapterIndex && e.source !== FINAL_STATE_COMPLETION_SOURCE
  )
  const chapterExpected = (plan.expectedEvents ?? []).filter((e) => e.chapterIndex === chapterIndex)
  const { validEvents, missingEvidence, invalidEvidence } = filterEventsByEvidence(
    chapterActual,
    options
  )
  const { valid: acceptedEvents, invalid: invalidDeadlineEvents } =
    partitionInvalidForeshadowIntroductions(validEvents)
  const finalState = reconcileFinalStateDeclarations(memory, chapterIndex, acceptedEvents, options)
  const completedActualEvents = [...chapterActual, ...finalState.autoCompletedEvents]
  const effectiveMemory = applyNewChapterEvents(memory, [
    ...acceptedEvents,
    ...finalState.autoCompletedEvents,
  ])
  const canonicalExpected = canonicalizeForeshadowFulfillmentEvents(memory, chapterExpected)
  const canonicalAccepted = canonicalizeForeshadowFulfillmentEvents(memory, acceptedEvents)

  const { missing, unexpected } = diffEvents(canonicalExpected, canonicalAccepted)

  const unfulfilledRequiredForeshadows: ForeshadowId[] = []
  const overdueForeshadows: ForeshadowId[] = []
  const falseFulfillments: ForeshadowId[] = []
  const currentChapter = chapterIndex + 1

  for (const fs of getCanonicalForeshadows(effectiveMemory)) {
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

  const actualFulfilledIds = new Set(
    canonicalAccepted.flatMap((event) =>
      event.type === 'foreshadow-fulfill' ? [event.foreshadowId] : []
    )
  )
  for (const id of canonicalizeKnownForeshadowIds(
    effectiveMemory,
    plan.fulfilledForeshadowIds ?? []
  )) {
    const actualFulfilled = actualFulfilledIds.has(id)
    if (!actualFulfilled) {
      falseFulfillments.push(id)
    }
  }

  const unclaimedMandatoryBeats: BeatId[] = []
  const claimedButUnprovenBeats: BeatId[] = []

  for (const beat of Object.values(effectiveMemory.beats)) {
    if (
      beat.required &&
      getCoveredMandatoryBeatId(options.storyArc, beat.id) === undefined &&
      !isBeatProven(options.storyArc, effectiveMemory, beat.id)
    ) {
      unclaimedMandatoryBeats.push(beat.id)
    }
  }

  const claimedBeatIds = [...(plan.claimedMandatoryBeatIds ?? []), ...(plan.claimedBeatIds ?? [])]
  for (const id of claimedBeatIds) {
    if (!isBeatProven(options.storyArc, effectiveMemory, id)) {
      claimedButUnprovenBeats.push(id)
    }
  }

  return {
    expectedEvents: chapterExpected,
    actualEvents: completedActualEvents,
    missingEvents: missing,
    unexpectedEvents: unexpected,
    eventsMissingEvidence: missingEvidence,
    eventsWithInvalidEvidence: invalidEvidence,
    eventsWithInvalidForeshadowDeadline: invalidDeadlineEvents,
    unfulfilledRequiredForeshadows,
    overdueForeshadows,
    falseFulfillments,
    foreshadowFulfillmentRejections: [],
    plotAdvanceRejections: [],
    unclaimedMandatoryBeats,
    claimedButUnprovenBeats,
    stateConflicts: detectStateConflicts(acceptedEvents),
    finalStateMismatches: finalState.finalStateMismatches,
    finalStateUncorroborated: finalState.finalStateUncorroborated,
    autoCompletedEvents: finalState.autoCompletedEvents,
    droppedUnauthorizedPlotAdvanceEvents: [],
  }
}

function canonicalizeForeshadowFulfillmentEvents(
  memory: StoryMemory,
  events: readonly StoryEvent[]
): StoryEvent[] {
  const canonicalEvents: StoryEvent[] = []
  const seenForeshadowIds = new Set<ForeshadowId>()

  for (const event of events) {
    if (event.type !== 'foreshadow-fulfill') {
      canonicalEvents.push(event)
      continue
    }

    const foreshadowId = resolveCanonicalForeshadowId(memory, event.foreshadowId)
    const canonicalId = foreshadowId ?? event.foreshadowId
    if (seenForeshadowIds.has(canonicalId)) continue
    seenForeshadowIds.add(canonicalId)
    canonicalEvents.push({ ...event, foreshadowId: canonicalId })
  }

  return canonicalEvents
}

function canonicalizeKnownForeshadowIds(
  memory: StoryMemory,
  ids: readonly ForeshadowId[]
): ForeshadowId[] {
  const canonicalIds: ForeshadowId[] = []
  const seen = new Set<ForeshadowId>()

  for (const id of ids) {
    const canonicalId = resolveCanonicalForeshadowId(memory, id) ?? id
    if (seen.has(canonicalId)) continue
    seen.add(canonicalId)
    canonicalIds.push(canonicalId)
  }

  return canonicalIds
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

/** 系统补全事件的事件源标记；每轮校验都会先剔除旧补全事件再按最新声明重算。 */
const FINAL_STATE_COMPLETION_SOURCE = 'final-state-completion' as const

interface FinalStateReconciliation {
  finalStateMismatches: FinalStateMismatch[]
  finalStateUncorroborated: FinalStateMismatch[]
  autoCompletedEvents: StoryEvent[]
}

/**
 * 校验章末终态声明，并对「返回原点」型不一致做确定性补全：
 * 当声明值等于章前投影值、且 writer 本章自己的事件流中出现过该值时，
 * 说明章末实体回到了出发状态而事件流漏发最后的归位事件——此时依据
 * writer 自己的结构化声明补发一条补全事件，而不是把叙事正确的声明
 * 当成错误阻塞章节（否则重写循环没有确定性出路）。
 * 只做 id/枚举级结构化比较，不触碰任何正文文本语义。
 */
function reconcileFinalStateDeclarations(
  memory: StoryMemory,
  chapterIndex: number,
  acceptedEvents: StoryEvent[],
  options: ChapterEventValidationOptions
): FinalStateReconciliation {
  const finalStateMismatches: FinalStateMismatch[] = []
  const finalStateUncorroborated: FinalStateMismatch[] = []
  const autoCompletedEvents: StoryEvent[] = []

  // 同一实体同一属性重复声明时以最后一条为准
  const declarations = new Map<string, ChapterFinalStateDeclaration>()
  for (const declaration of options.finalStateDeclarations ?? []) {
    declarations.set(`${declaration.entityId} ${declaration.attribute}`, declaration)
  }

  const paragraphCount =
    options.chapterContent !== undefined ? countEvidenceParagraphs(options.chapterContent) : null

  for (const declaration of declarations.values()) {
    const supportedTypes = FINAL_STATE_EVENT_TYPES[declaration.attribute]
    const candidates = acceptedEvents.filter(
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
    if (actualValue === declaration.value) continue

    // 返回原点检测（全部满足才补全，任一不满足则保持 mismatch 报错）：
    // 1) 有正文可定位补全事件的证据段落；
    // 2) 声明值等于章前投影值（确实回到了出发状态，而非编造新状态）；
    // 3) 声明值在 writer 本章自己的该实体支撑事件里出现过（事件流自己佐证）。
    if (
      paragraphCount !== null &&
      matchesPreChapterProjection(memory, declaration) &&
      candidates.some((event) => finalStateEventValue(event) === declaration.value)
    ) {
      autoCompletedEvents.push(
        buildFinalStateCompletionEvent(lastEvent, declaration, memory, chapterIndex, paragraphCount)
      )
      continue
    }

    finalStateMismatches.push({
      entityId: declaration.entityId,
      attribute: declaration.attribute,
      declaredValue: declaration.value,
      actualValue,
    })
  }

  return { finalStateMismatches, finalStateUncorroborated, autoCompletedEvents }
}

function matchesPreChapterProjection(
  memory: StoryMemory,
  declaration: ChapterFinalStateDeclaration
): boolean {
  const character = memory.entities.characters[declaration.entityId]
  const item = memory.entities.items[declaration.entityId]
  if (declaration.attribute === 'location') {
    const projected = character
      ? character.locationId
      : item
        ? (item.locationId ?? item.holderId)
        : null
    return projected !== null && projected === declaration.value
  }
  const record: Record<string, unknown> = character?.status ?? item?.state ?? {}
  return Object.values(record).some((value) => value === declaration.value)
}

/**
 * 复制该实体本章最后一条支撑事件，把值字段替换为声明值，生成一条补全事件。
 * 证据指向正文末段（归位/状态回写发生在章末）；source 标记为系统补全。
 */
function buildFinalStateCompletionEvent(
  lastEvent: StoryEvent,
  declaration: ChapterFinalStateDeclaration,
  memory: StoryMemory,
  chapterIndex: number,
  paragraphIndex: number
): StoryEvent {
  const base = {
    id: generateId('evt_'),
    chapterIndex,
    source: FINAL_STATE_COMPLETION_SOURCE,
    evidence: { paragraphIndex },
  }
  switch (lastEvent.type) {
    case 'character-location':
      return {
        ...base,
        type: 'character-location',
        characterId: lastEvent.characterId,
        locationId: declaration.value,
      }
    case 'character-status':
      return {
        ...base,
        type: 'character-status',
        characterId: lastEvent.characterId,
        attribute: lastEvent.attribute,
        value: declaration.value,
      }
    case 'item-location': {
      // 与写作约定一致：物品被角色随身携带时 locationId 与 holderId 同为该角色 id；
      // 停留在固定地点时 holderId 为 null。
      const carriedByCharacter =
        declaration.value !== null && Boolean(memory.entities.characters[declaration.value])
      return {
        ...base,
        type: 'item-location',
        itemId: lastEvent.itemId,
        holderId: carriedByCharacter ? declaration.value : null,
        locationId: declaration.value,
      }
    }
    case 'item-state':
      return {
        ...base,
        type: 'item-state',
        itemId: lastEvent.itemId,
        attribute: lastEvent.attribute,
        value: declaration.value,
      }
    default:
      // 支撑类型表只含上述四类事件，此处不可达
      throw new Error(`unsupported final-state completion event type: ${lastEvent.type}`)
  }
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
