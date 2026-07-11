import { generateId } from '../utils/id.js'
import type { ForeshadowKind, StoryEvent, StoryEventEvidence } from '../types/story-memory.js'

export function parseStoryEventsBlock(text: string, chapterIndex: number): StoryEvent[] {
  const match = text.match(/=== STORY_EVENTS ===\n([\s\S]*?)\n=== CHAPTER_CONTENT ===/)
  if (!match) return []
  const block = match[1] ?? ''
  const events: StoryEvent[] = []

  for (const line of block.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parsed = parseEventLine(trimmed, chapterIndex)
    if (parsed) events.push(parsed)
  }

  return events
}

function parseEventLine(line: string, chapterIndex: number): StoryEvent | null {
  const { eventLine, evidence } = extractEvidence(line)

  const charLoc = eventLine.match(/^-\s*character-location:\s*(\S+)\s*->\s*(\S+)$/)
  if (charLoc) {
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'character-location',
        characterId: charLoc[1]!,
        locationId: charLoc[2]!,
        chapterIndex,
        source: 'chapter',
      },
      evidence
    )
  }

  const charStatus = eventLine.match(/^-\s*character-status:\s*(\S+)\s*\/\s*(\S+)\s*->\s*(.+)$/)
  if (charStatus) {
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'character-status',
        characterId: charStatus[1]!,
        attribute: charStatus[2]!,
        value: charStatus[3]!.trim(),
        chapterIndex,
        source: 'chapter',
      },
      evidence
    )
  }

  const itemLoc = eventLine.match(/^-\s*item-location:\s*(\S+)\s*->\s*(\S+)$/)
  if (itemLoc) {
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
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'item-state',
        itemId: itemState[1]!,
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
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'foreshadow-fulfill',
        foreshadowId: fsFulfill[1]!,
        chapterIndex,
        source: 'chapter',
      },
      evidence
    )
  }

  const beatAdvance = eventLine.match(/^-\s*plot-advance:\s*(\S+)\s*\/\s*(\S+)$/)
  if (beatAdvance) {
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'plot-advance',
        plotId: beatAdvance[1]!,
        beatId: beatAdvance[2]!,
        chapterIndex,
        source: 'chapter',
      },
      evidence
    )
  }

  const taskCreate = eventLine.match(/^-\s*task-create:\s*(\S+)\s*\/\s*(.+)$/)
  if (taskCreate) {
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'task-create',
        taskId: taskCreate[1]!,
        description: taskCreate[2]!.trim(),
        chapterIndex,
        source: 'chapter',
      },
      evidence
    )
  }

  const taskResolve = eventLine.match(/^-\s*task-resolve:\s*(\S+)$/)
  if (taskResolve) {
    return withEvidence(
      {
        id: generateId('evt'),
        type: 'task-resolve',
        taskId: taskResolve[1]!,
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
  const kind = parseForeshadowKind(fields.kind)
  const required = parseOptionalBoolean(fields.required)
  const beatId = parseNullableId(fields.beat)
  const text = fields.text?.trim()

  return {
    id: generateId('evt'),
    type: 'foreshadow-introduce',
    foreshadowId: match[1],
    expectedFulfillChapter: expected,
    chapterIndex,
    source: 'chapter',
    ...(text ? { text } : {}),
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
