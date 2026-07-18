import { generateId } from '../utils/id.js'
import { logger } from '../utils/logger.js'
import { parseJsonFromLLM } from '../utils/json.js'
import type {
  ChapterFinalStateDeclaration,
  FinalStateAttribute,
  ForeshadowKind,
  StoryEvent,
  StoryEventEvidence,
} from '../types/story-memory.js'
import { isMachineReadableId } from './identifier.js'
import { isForeshadowResolutionPolicy } from './resolution-policy.js'

export function parseStoryEventsBlock(text: string, chapterIndex: number): StoryEvent[] {
  const match = text.match(/=== STORY_EVENTS ===\n([\s\S]*?)\n=== CHAPTER_CONTENT ===/)
  if (!match) return []
  const block = match[1] ?? ''
  const events: StoryEvent[] = []

  for (const line of block.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parsed = parseEventLine(trimmed, chapterIndex)
    if (!parsed) continue
    events.push(parsed)
  }

  return events
}

const FINAL_STATE_BLOCK_PATTERN =
  /===\s*STORY_FINAL_STATE\s*===\s*([\s\S]*?)(?:\n===\s*[A-Z_]+\s*===|$)/i
const FINAL_STATE_ATTRIBUTES: readonly FinalStateAttribute[] = ['location', 'status']

export function parseStoryFinalStateBlock(text: string): ChapterFinalStateDeclaration[] {
  const match = text.match(FINAL_STATE_BLOCK_PATTERN)
  if (!match) return []
  const block = (match[1] ?? '').trim()
  if (!block) return []

  const parsed = parseJsonFromLLM<unknown>(block)
  if (!parsed.success || !Array.isArray(parsed.data)) {
    logger.warn('[MuseFlow] STORY_FINAL_STATE 区块不是合法 JSON 数组，已忽略')
    return []
  }

  const declarations: ChapterFinalStateDeclaration[] = []
  for (const entry of parsed.data) {
    const declaration = parseFinalStateDeclaration(entry)
    if (!declaration) continue
    declarations.push(declaration)
  }
  return declarations
}

function parseFinalStateDeclaration(entry: unknown): ChapterFinalStateDeclaration | null {
  if (typeof entry !== 'object' || entry === null) {
    logger.warn(`[MuseFlow] 丢弃非法 STORY_FINAL_STATE 条目: ${JSON.stringify(entry)}`)
    return null
  }
  const { entityId, attribute, value } = entry as Record<string, unknown>
  if (
    !isMachineReadableId(entityId) ||
    typeof attribute !== 'string' ||
    !FINAL_STATE_ATTRIBUTES.includes(attribute as FinalStateAttribute)
  ) {
    logger.warn(`[MuseFlow] 丢弃非法 STORY_FINAL_STATE 条目: ${JSON.stringify(entry)}`)
    return null
  }

  // Normalize nullable tokens for location attributes; status must remain a
  // non-empty string (the verbatim event value).
  let normalizedValue: string | null
  if (attribute === 'location' && (value === null || value === 'null' || value === 'none')) {
    normalizedValue = null
  } else if (typeof value === 'string' && value.trim().length > 0 && value.length <= 100) {
    normalizedValue = value.trim()
  } else {
    logger.warn(`[MuseFlow] 丢弃非法 STORY_FINAL_STATE 条目: ${JSON.stringify(entry)}`)
    return null
  }

  // location values must be structured ids or null; status values mirror the
  // corresponding event value verbatim, so only location is id-gated.
  if (
    attribute === 'location' &&
    normalizedValue !== null &&
    !isMachineReadableId(normalizedValue)
  ) {
    logger.warn(
      `[MuseFlow] 丢弃非法 STORY_FINAL_STATE 条目（location 值必须为结构化 ID 或 null）: ${JSON.stringify(entry)}`
    )
    return null
  }
  // status values must be the event value itself, not a "key=value" concatenation.
  if (attribute === 'status' && normalizedValue !== null && normalizedValue.includes('=')) {
    logger.warn(
      `[MuseFlow] 丢弃非法 STORY_FINAL_STATE 条目（status 值禁止写成 attribute=value，应只写事件值本身）: ${JSON.stringify(entry)}`
    )
    return null
  }
  return { entityId, attribute: attribute as FinalStateAttribute, value: normalizedValue }
}

function parseEventLine(line: string, chapterIndex: number): StoryEvent | null {
  const { eventLine, evidence } = extractEvidence(line)

  const charLoc = eventLine.match(/^-\s*character-location:\s*(\S+)\s*->\s*(\S+)$/)
  if (charLoc) {
    if (!isMachineReadableId(charLoc[1])) {
      logger.warn(`[MuseFlow] 丢弃含非法 characterId 的 STORY_EVENTS 行: ${line}`)
      return null
    }
    const locationId = parseNullableId(charLoc[2])
    if (locationId === undefined) return null
    if (locationId !== null && !isMachineReadableId(locationId)) {
      logger.warn(`[MuseFlow] 丢弃含非法 locationId 的 STORY_EVENTS 行: ${line}`)
      return null
    }
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'character-location',
        characterId: charLoc[1],
        locationId,
        chapterIndex,
        source: 'chapter',
      },
      evidence
    )
  }

  const charStatus = eventLine.match(/^-\s*character-status:\s*(\S+)\s*\/\s*(\S+)\s*->\s*(.+)$/)
  if (charStatus) {
    if (!isMachineReadableId(charStatus[1])) {
      logger.warn(`[MuseFlow] 丢弃含非法 characterId 的 STORY_EVENTS 行: ${line}`)
      return null
    }
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'character-status',
        characterId: charStatus[1],
        attribute: charStatus[2]!,
        value: charStatus[3]!.trim(),
        chapterIndex,
        source: 'chapter',
      },
      evidence
    )
  }

  const itemLocCanonical = eventLine.match(/^-\s*item-location:\s*(\S+)\s*\/\s*(.+)$/)
  if (itemLocCanonical?.[1] && itemLocCanonical[2] && isMachineReadableId(itemLocCanonical[1])) {
    const fields = parseMachineFields(itemLocCanonical[2])
    const holderId = parseNullableId(fields.holder)
    const locationId = parseNullableId(fields.location)
    if (
      holderId === undefined ||
      locationId === undefined ||
      (holderId !== null && !isMachineReadableId(holderId)) ||
      (locationId !== null && !isMachineReadableId(locationId))
    ) {
      return null
    }
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'item-location',
        itemId: itemLocCanonical[1],
        holderId,
        locationId,
        chapterIndex,
        source: 'chapter',
      },
      evidence
    )
  }

  const itemLoc = eventLine.match(/^-\s*item-location:\s*(\S+)\s*->\s*(\S+)$/)
  if (itemLoc) {
    if (!isMachineReadableId(itemLoc[1]) || !isMachineReadableId(itemLoc[2])) return null
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'item-location',
        itemId: itemLoc[1]!,
        holderId: itemLoc[2]!,
        locationId: null,
        chapterIndex,
        source: 'chapter',
      },
      evidence
    )
  }

  const itemState = eventLine.match(/^-\s*item-state:\s*(\S+)\s*\/\s*(\S+)\s*->\s*(.+)$/)
  if (itemState) {
    if (!isMachineReadableId(itemState[1])) {
      logger.warn(`[MuseFlow] 丢弃含非法 itemId 的 STORY_EVENTS 行: ${line}`)
      return null
    }
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'item-state',
        itemId: itemState[1],
        attribute: itemState[2]!,
        value: itemState[3]!.trim(),
        chapterIndex,
        source: 'chapter',
      },
      evidence
    )
  }

  const fsIntroduce = parseForeshadowIntroduce(eventLine, chapterIndex)
  if (fsIntroduce) {
    return withEvidence(fsIntroduce, evidence)
  }

  const fsFulfill = eventLine.match(/^-\s*foreshadow-fulfill:\s*(\S+)$/)
  if (fsFulfill) {
    if (!isMachineReadableId(fsFulfill[1])) {
      logger.warn(`[MuseFlow] 丢弃含非法 foreshadowId 的 STORY_EVENTS 行: ${line}`)
      return null
    }
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'foreshadow-fulfill',
        foreshadowId: fsFulfill[1],
        chapterIndex,
        source: 'chapter',
      },
      evidence
    )
  }

  const beatAdvance = eventLine.match(/^-\s*plot-advance:\s*(\S+)\s*\/\s*(\S+)$/)
  if (beatAdvance) {
    if (!isMachineReadableId(beatAdvance[1]) || !isMachineReadableId(beatAdvance[2])) {
      logger.warn(`[MuseFlow] 丢弃含非法 plotId/beatId 的 STORY_EVENTS 行: ${line}`)
      return null
    }
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'plot-advance',
        plotId: beatAdvance[1],
        beatId: beatAdvance[2],
        chapterIndex,
        source: 'chapter',
      },
      evidence
    )
  }

  const taskCreate = eventLine.match(/^-\s*task-create:\s*(\S+)\s*\/\s*(.+)$/)
  if (taskCreate) {
    if (!isMachineReadableId(taskCreate[1])) {
      logger.warn(`[MuseFlow] 丢弃含非法 taskId 的 STORY_EVENTS 行: ${line}`)
      return null
    }
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'task-create',
        taskId: taskCreate[1],
        description: taskCreate[2]!.trim(),
        chapterIndex,
        source: 'chapter',
      },
      evidence
    )
  }

  const taskResolve = eventLine.match(/^-\s*task-resolve:\s*(\S+)$/)
  if (taskResolve) {
    if (!isMachineReadableId(taskResolve[1])) {
      logger.warn(`[MuseFlow] 丢弃含非法 taskId 的 STORY_EVENTS 行: ${line}`)
      return null
    }
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'task-resolve',
        taskId: taskResolve[1],
        chapterIndex,
        source: 'chapter',
      },
      evidence
    )
  }

  return null
}

function extractEvidence(line: string): {
  eventLine: string
  evidence?: StoryEventEvidence
} {
  const match = line.match(/\s+@p(\d+)\s*$/i)
  if (!match || !match[1]) return { eventLine: line }

  const paragraphIndex = Number.parseInt(match[1], 10)
  const eventLine = line.slice(0, match.index).trimEnd()
  if (!Number.isInteger(paragraphIndex) || paragraphIndex < 1) {
    return { eventLine }
  }
  return { eventLine, evidence: { paragraphIndex } }
}

function parseForeshadowIntroduce(
  eventLine: string,
  chapterIndex: number
): Extract<StoryEvent, { type: 'foreshadow-introduce' }> | null {
  const match = eventLine.match(/^-\s*foreshadow-introduce:\s*(\S+)\s*(?:\/\s*(.+))?$/)
  if (!match || !match[1]) return null
  if (!isMachineReadableId(match[1])) {
    logger.warn(`[MuseFlow] 丢弃含非法 foreshadowId 的 STORY_EVENTS 行: ${eventLine}`)
    return null
  }

  const rest = match[2]?.trim()
  if (!rest) {
    return {
      id: generateId('evt'),
      type: 'foreshadow-introduce',
      foreshadowId: match[1],
      expectedFulfillChapter: null,
      chapterIndex,
      source: 'chapter',
    }
  }

  if (!rest.includes('=')) {
    return {
      id: generateId('evt'),
      type: 'foreshadow-introduce',
      foreshadowId: match[1],
      expectedFulfillChapter: Number(rest),
      chapterIndex,
      source: 'chapter',
    }
  }

  const fields = parseMachineFields(rest)
  const expected = parseOptionalNumber(fields.expected)
  const resolutionPolicy = isForeshadowResolutionPolicy(fields.policy) ? fields.policy : undefined
  const kind = parseForeshadowKind(fields.kind)
  const required = parseOptionalBoolean(fields.required)
  const beatId = parseNullableId(fields.beat)
  const text = fields.text?.trim()
  const resolutionQuestion = fields.question?.trim()
  const fulfillmentCriteria = fields.criteria?.trim()

  return {
    id: generateId('evt'),
    type: 'foreshadow-introduce',
    foreshadowId: match[1],
    expectedFulfillChapter: expected,
    chapterIndex,
    source: 'chapter',
    ...(resolutionPolicy ? { resolutionPolicy } : {}),
    ...(text ? { text } : {}),
    ...(resolutionQuestion ? { resolutionQuestion } : {}),
    ...(fulfillmentCriteria ? { fulfillmentCriteria } : {}),
    ...(kind ? { kind } : {}),
    ...(required !== undefined ? { required } : {}),
    ...(beatId !== undefined ? { beatId } : {}),
  }
}

function parseMachineFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const part of text.split(/\s+\/\s+/)) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key.length > 0) {
      fields[key] = value
    }
  }
  return fields
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (value === undefined || value === '' || value === 'null' || value === 'none') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function parseNullableId(value: string | undefined): string | null | undefined {
  if (value === undefined || value === '') return undefined
  if (value === 'null' || value === 'none') return null
  return value
}

function parseForeshadowKind(value: string | undefined): ForeshadowKind | undefined {
  if (
    value === 'character_arc' ||
    value === 'environmental_detail' ||
    value === 'dialogue_hint' ||
    value === 'object_foreshadow' ||
    value === 'inner_conflict' ||
    value === 'plot' ||
    value === 'other'
  ) {
    return value
  }
  return undefined
}

function withEvidence<T extends StoryEvent>(event: T, evidence: StoryEventEvidence | undefined): T {
  return evidence ? ({ ...event, evidence } as T) : event
}
