import type { ForeshadowKind, StoryEvent } from '../types/story-memory.js'

export interface StoryEventNormalizationOptions {
  chapterIndex: number
  mode: 'strict' | 'legacy'
}

export type StoryEventNormalizationResult =
  | { ok: true; event: StoryEvent; normalized: boolean }
  | { ok: false; reason: string }

export interface StoryEventListNormalizationResult {
  events: StoryEvent[]
  invalid: Array<{ index: number; reason: string }>
  normalized: boolean
}

const FORESHADOW_KINDS = new Set<ForeshadowKind>([
  'character_arc',
  'environmental_detail',
  'dialogue_hint',
  'object_foreshadow',
  'inner_conflict',
  'plot',
  'other',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._:-]*$/.test(value)
}

function isNullableId(value: unknown): value is string | null {
  return value === null || isId(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function invalid(reason: string): StoryEventNormalizationResult {
  return { ok: false, reason }
}

interface NormalizedBase {
  id: string
  chapterIndex: number
  source: 'outline' | 'chapter'
  normalized: boolean
}

function normalizeBase(
  record: Record<string, unknown>,
  options: StoryEventNormalizationOptions
): NormalizedBase | string {
  if (!isId(record.id)) return 'event.id must be a machine-readable identifier'
  if (typeof record.chapterIndex !== 'number' || !Number.isInteger(record.chapterIndex)) {
    return 'event.chapterIndex must be an integer'
  }

  let source: 'outline' | 'chapter'
  let normalized = record.chapterIndex !== options.chapterIndex
  if (record.source === 'outline' || record.source === 'chapter') {
    source = record.source
  } else if (options.mode === 'legacy' && record.source === undefined) {
    source = 'chapter'
    normalized = true
  } else {
    return 'event.source must be outline or chapter'
  }

  return {
    id: record.id,
    chapterIndex: options.chapterIndex,
    source,
    normalized,
  }
}

export function normalizeStoryEvent(
  value: unknown,
  options: StoryEventNormalizationOptions
): StoryEventNormalizationResult {
  if (!isRecord(value)) return invalid('event must be an object')
  if (!isNonEmptyString(value.type)) return invalid('event.type must be a non-empty string')

  const base = normalizeBase(value, options)
  if (typeof base === 'string') return invalid(base)

  switch (value.type) {
    case 'character-location': {
      if (!isId(value.characterId)) {
        return invalid('character-location.characterId must be an identifier')
      }
      if (!hasOwn(value, 'locationId') || !isNullableId(value.locationId)) {
        return invalid('character-location.locationId must be an identifier or null')
      }
      return {
        ok: true,
        normalized: base.normalized,
        event: {
          id: base.id,
          type: value.type,
          characterId: value.characterId,
          locationId: value.locationId,
          chapterIndex: base.chapterIndex,
          source: base.source,
        },
      }
    }
    case 'character-status': {
      if (!isId(value.characterId)) {
        return invalid('character-status.characterId must be an identifier')
      }
      if (!isNonEmptyString(value.attribute)) {
        return invalid('character-status.attribute must be a non-empty string')
      }
      if (!hasOwn(value, 'value')) return invalid('character-status.value is required')
      return {
        ok: true,
        normalized: base.normalized,
        event: {
          id: base.id,
          type: value.type,
          characterId: value.characterId,
          attribute: value.attribute,
          value: value.value,
          chapterIndex: base.chapterIndex,
          source: base.source,
        },
      }
    }
    case 'item-location': {
      if (!isId(value.itemId)) return invalid('item-location.itemId must be an identifier')

      const hasHolder = hasOwn(value, 'holderId')
      const hasLocation = hasOwn(value, 'locationId')
      if (options.mode === 'strict' && !hasHolder) {
        return invalid('item-location.holderId must be an identifier or null')
      }
      if (options.mode === 'strict' && !hasLocation) {
        return invalid('item-location.locationId must be an identifier or null')
      }
      if (!hasHolder && !hasLocation) {
        return invalid('item-location requires holderId or locationId')
      }

      const holderId = hasHolder ? value.holderId : null
      const locationId = hasLocation ? value.locationId : null
      if (!isNullableId(holderId)) {
        return invalid('item-location.holderId must be an identifier or null')
      }
      if (!isNullableId(locationId)) {
        return invalid('item-location.locationId must be an identifier or null')
      }

      return {
        ok: true,
        normalized: base.normalized || !hasHolder || !hasLocation,
        event: {
          id: base.id,
          type: value.type,
          itemId: value.itemId,
          holderId,
          locationId,
          chapterIndex: base.chapterIndex,
          source: base.source,
        },
      }
    }
    case 'item-state': {
      if (!isId(value.itemId)) return invalid('item-state.itemId must be an identifier')
      if (!isNonEmptyString(value.attribute)) {
        return invalid('item-state.attribute must be a non-empty string')
      }
      if (!hasOwn(value, 'value')) return invalid('item-state.value is required')
      return {
        ok: true,
        normalized: base.normalized,
        event: {
          id: base.id,
          type: value.type,
          itemId: value.itemId,
          attribute: value.attribute,
          value: value.value,
          chapterIndex: base.chapterIndex,
          source: base.source,
        },
      }
    }
    case 'plot-advance': {
      if (!isId(value.plotId)) return invalid('plot-advance.plotId must be an identifier')
      if (!isId(value.beatId)) return invalid('plot-advance.beatId must be an identifier')
      return {
        ok: true,
        normalized: base.normalized,
        event: {
          id: base.id,
          type: value.type,
          plotId: value.plotId,
          beatId: value.beatId,
          chapterIndex: base.chapterIndex,
          source: base.source,
        },
      }
    }
    case 'foreshadow-introduce': {
      if (!isId(value.foreshadowId)) {
        return invalid('foreshadow-introduce.foreshadowId must be an identifier')
      }
      if (
        !hasOwn(value, 'expectedFulfillChapter') ||
        (value.expectedFulfillChapter !== null &&
          (typeof value.expectedFulfillChapter !== 'number' ||
            !Number.isInteger(value.expectedFulfillChapter)))
      ) {
        return invalid('foreshadow-introduce.expectedFulfillChapter must be an integer or null')
      }
      if (value.text !== undefined && !isNonEmptyString(value.text)) {
        return invalid('foreshadow-introduce.text must be a non-empty string when present')
      }
      if (
        value.kind !== undefined &&
        (typeof value.kind !== 'string' || !FORESHADOW_KINDS.has(value.kind as ForeshadowKind))
      ) {
        return invalid('foreshadow-introduce.kind is invalid')
      }
      if (value.required !== undefined && typeof value.required !== 'boolean') {
        return invalid('foreshadow-introduce.required must be boolean when present')
      }
      if (value.beatId !== undefined && !isNullableId(value.beatId)) {
        return invalid('foreshadow-introduce.beatId must be an identifier or null when present')
      }

      return {
        ok: true,
        normalized: base.normalized,
        event: {
          id: base.id,
          type: value.type,
          foreshadowId: value.foreshadowId,
          expectedFulfillChapter: value.expectedFulfillChapter,
          chapterIndex: base.chapterIndex,
          source: base.source,
          ...(value.text !== undefined ? { text: value.text } : {}),
          ...(value.kind !== undefined ? { kind: value.kind as ForeshadowKind } : {}),
          ...(value.required !== undefined ? { required: value.required } : {}),
          ...(value.beatId !== undefined ? { beatId: value.beatId } : {}),
        },
      }
    }
    case 'foreshadow-fulfill': {
      if (!isId(value.foreshadowId)) {
        return invalid('foreshadow-fulfill.foreshadowId must be an identifier')
      }
      return {
        ok: true,
        normalized: base.normalized,
        event: {
          id: base.id,
          type: value.type,
          foreshadowId: value.foreshadowId,
          chapterIndex: base.chapterIndex,
          source: base.source,
        },
      }
    }
    case 'task-create': {
      if (!isId(value.taskId)) return invalid('task-create.taskId must be an identifier')
      if (!isNonEmptyString(value.description)) {
        return invalid('task-create.description must be a non-empty string')
      }
      return {
        ok: true,
        normalized: base.normalized,
        event: {
          id: base.id,
          type: value.type,
          taskId: value.taskId,
          description: value.description,
          chapterIndex: base.chapterIndex,
          source: base.source,
        },
      }
    }
    case 'task-resolve': {
      if (!isId(value.taskId)) return invalid('task-resolve.taskId must be an identifier')
      return {
        ok: true,
        normalized: base.normalized,
        event: {
          id: base.id,
          type: value.type,
          taskId: value.taskId,
          chapterIndex: base.chapterIndex,
          source: base.source,
        },
      }
    }
    default:
      return invalid(`unsupported event type: ${value.type}`)
  }
}

export function normalizeStoryEvents(
  values: unknown[],
  options: StoryEventNormalizationOptions
): StoryEventListNormalizationResult {
  const events: StoryEvent[] = []
  const invalidEvents: Array<{ index: number; reason: string }> = []
  let normalized = false

  values.forEach((value, index) => {
    const result = normalizeStoryEvent(value, options)
    if (!result.ok) {
      invalidEvents.push({ index, reason: result.reason })
      return
    }
    events.push(result.event)
    normalized ||= result.normalized
  })

  return { events, invalid: invalidEvents, normalized }
}
