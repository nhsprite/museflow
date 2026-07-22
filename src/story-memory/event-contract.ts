import type { ForeshadowKind, StoryEvent, StoryEventEvidence } from '../types/story-memory.js'
import { isMachineReadableId } from './identifier.js'
import {
  deriveLegacyRequired,
  isForeshadowResolutionPolicy,
  normalizeLegacyForeshadowFields,
  validatePolicyDeadline,
} from './resolution-policy.js'

export interface StoryEventNormalizationOptions {
  chapterIndex: number
  mode: 'strict' | 'legacy'
}

export type StoryEventNormalizationResult =
  { ok: true; event: StoryEvent; normalized: boolean } | { ok: false; reason: string }

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

function isNullableId(value: unknown): value is string | null {
  return value === null || isMachineReadableId(value)
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
  source: 'outline' | 'chapter' | 'final-state-completion'
  evidence?: StoryEventEvidence
  normalized: boolean
}

function normalizeBase(
  record: Record<string, unknown>,
  options: StoryEventNormalizationOptions
): NormalizedBase | string {
  if (!isMachineReadableId(record.id)) return 'event.id must be a machine-readable identifier'
  if (typeof record.chapterIndex !== 'number' || !Number.isInteger(record.chapterIndex)) {
    return 'event.chapterIndex must be an integer'
  }

  let source: 'outline' | 'chapter' | 'final-state-completion'
  let normalized = record.chapterIndex !== options.chapterIndex
  if (
    record.source === 'outline' ||
    record.source === 'chapter' ||
    record.source === 'final-state-completion'
  ) {
    source = record.source
  } else if (options.mode === 'legacy' && record.source === undefined) {
    source = 'chapter'
    normalized = true
  } else {
    return 'event.source must be outline, chapter or final-state-completion'
  }

  let evidence: StoryEventEvidence | undefined
  if (record.evidence !== undefined) {
    if (!isRecord(record.evidence)) return 'event.evidence must be an object when present'
    if (
      typeof record.evidence.paragraphIndex !== 'number' ||
      !Number.isInteger(record.evidence.paragraphIndex) ||
      record.evidence.paragraphIndex < 1
    ) {
      return 'event.evidence.paragraphIndex must be a positive integer'
    }
    evidence = { paragraphIndex: record.evidence.paragraphIndex }
  }

  return {
    id: record.id,
    chapterIndex: options.chapterIndex,
    source,
    ...(evidence ? { evidence } : {}),
    normalized,
  }
}

function eventBase(base: NormalizedBase) {
  return {
    id: base.id,
    chapterIndex: base.chapterIndex,
    source: base.source,
    ...(base.evidence ? { evidence: base.evidence } : {}),
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
      if (!isMachineReadableId(value.characterId)) {
        return invalid('character-location.characterId must be an identifier')
      }
      if (!hasOwn(value, 'locationId') || !isNullableId(value.locationId)) {
        return invalid('character-location.locationId must be an identifier or null')
      }
      return {
        ok: true,
        normalized: base.normalized,
        event: {
          ...eventBase(base),
          type: value.type,
          characterId: value.characterId,
          locationId: value.locationId,
        },
      }
    }
    case 'character-status': {
      if (!isMachineReadableId(value.characterId)) {
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
          ...eventBase(base),
          type: value.type,
          characterId: value.characterId,
          attribute: value.attribute,
          value: value.value,
        },
      }
    }
    case 'item-location': {
      if (!isMachineReadableId(value.itemId)) {
        return invalid('item-location.itemId must be an identifier')
      }

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
          ...eventBase(base),
          type: value.type,
          itemId: value.itemId,
          holderId,
          locationId,
        },
      }
    }
    case 'item-state': {
      if (!isMachineReadableId(value.itemId)) {
        return invalid('item-state.itemId must be an identifier')
      }
      if (!isNonEmptyString(value.attribute)) {
        return invalid('item-state.attribute must be a non-empty string')
      }
      if (!hasOwn(value, 'value')) return invalid('item-state.value is required')
      return {
        ok: true,
        normalized: base.normalized,
        event: {
          ...eventBase(base),
          type: value.type,
          itemId: value.itemId,
          attribute: value.attribute,
          value: value.value,
        },
      }
    }
    case 'plot-advance': {
      if (!isMachineReadableId(value.plotId)) {
        return invalid('plot-advance.plotId must be an identifier')
      }
      if (!isMachineReadableId(value.beatId)) {
        return invalid('plot-advance.beatId must be an identifier')
      }
      return {
        ok: true,
        normalized: base.normalized,
        event: {
          ...eventBase(base),
          type: value.type,
          plotId: value.plotId,
          beatId: value.beatId,
        },
      }
    }
    case 'foreshadow-introduce': {
      if (!isMachineReadableId(value.foreshadowId)) {
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
      if (hasOwn(value, 'resolutionQuestion') && !isNonEmptyString(value.resolutionQuestion)) {
        return invalid(
          'foreshadow-introduce.resolutionQuestion must be a non-empty string when present'
        )
      }
      if (hasOwn(value, 'fulfillmentCriteria') && !isNonEmptyString(value.fulfillmentCriteria)) {
        return invalid(
          'foreshadow-introduce.fulfillmentCriteria must be a non-empty string when present'
        )
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

      if (options.mode === 'strict' && value.resolutionPolicy === undefined) {
        return invalid('foreshadow-introduce.resolutionPolicy is required in strict mode')
      }
      if (
        value.resolutionPolicy !== undefined &&
        !isForeshadowResolutionPolicy(value.resolutionPolicy)
      ) {
        return invalid('foreshadow-introduce.resolutionPolicy is invalid')
      }
      const normalizedForeshadow = isForeshadowResolutionPolicy(value.resolutionPolicy)
        ? {
            resolutionPolicy: value.resolutionPolicy,
            expectedFulfillChapter: value.expectedFulfillChapter,
          }
        : normalizeLegacyForeshadowFields(
            typeof value.required === 'boolean' ? value.required : undefined,
            value.expectedFulfillChapter
          )
      const { resolutionPolicy, expectedFulfillChapter } = normalizedForeshadow
      if (!validatePolicyDeadline(resolutionPolicy, expectedFulfillChapter)) {
        return invalid('foreshadow-introduce policy and deadline are inconsistent')
      }
      const required = deriveLegacyRequired(resolutionPolicy)

      return {
        ok: true,
        normalized:
          base.normalized ||
          value.resolutionPolicy === undefined ||
          value.required !== required ||
          value.expectedFulfillChapter !== expectedFulfillChapter,
        event: {
          ...eventBase(base),
          type: value.type,
          foreshadowId: value.foreshadowId,
          expectedFulfillChapter,
          resolutionPolicy,
          ...(value.text !== undefined ? { text: value.text } : {}),
          ...(typeof value.resolutionQuestion === 'string'
            ? { resolutionQuestion: value.resolutionQuestion }
            : {}),
          ...(typeof value.fulfillmentCriteria === 'string'
            ? { fulfillmentCriteria: value.fulfillmentCriteria }
            : {}),
          ...(value.kind !== undefined ? { kind: value.kind as ForeshadowKind } : {}),
          required,
          ...(value.beatId !== undefined ? { beatId: value.beatId } : {}),
        },
      }
    }
    case 'foreshadow-policy-set': {
      if (!isMachineReadableId(value.foreshadowId)) {
        return invalid('foreshadow-policy-set.foreshadowId must be an identifier')
      }
      if (!isForeshadowResolutionPolicy(value.resolutionPolicy)) {
        return invalid('foreshadow-policy-set.resolutionPolicy is invalid')
      }
      const deadline = value.expectedFulfillChapter
      if (
        (deadline !== null && (typeof deadline !== 'number' || !Number.isInteger(deadline))) ||
        !validatePolicyDeadline(value.resolutionPolicy, deadline)
      ) {
        return invalid('foreshadow-policy-set policy and deadline are inconsistent')
      }
      return {
        ok: true,
        normalized: base.normalized,
        event: {
          ...eventBase(base),
          type: value.type,
          foreshadowId: value.foreshadowId,
          resolutionPolicy: value.resolutionPolicy,
          expectedFulfillChapter: deadline,
        },
      }
    }
    case 'foreshadow-merge': {
      if (base.source !== 'outline') {
        return invalid('foreshadow-merge.source must be outline')
      }
      if (!isMachineReadableId(value.canonicalForeshadowId)) {
        return invalid('foreshadow-merge.canonicalForeshadowId must be an identifier')
      }
      if (!isMachineReadableId(value.duplicateForeshadowId)) {
        return invalid('foreshadow-merge.duplicateForeshadowId must be an identifier')
      }
      if (value.canonicalForeshadowId === value.duplicateForeshadowId) {
        return invalid('foreshadow-merge ids must be different')
      }
      if (!isNonEmptyString(value.reason)) {
        return invalid('foreshadow-merge.reason must be a non-empty string')
      }
      return {
        ok: true,
        normalized: base.normalized,
        event: {
          ...eventBase(base),
          type: value.type,
          source: base.source,
          canonicalForeshadowId: value.canonicalForeshadowId,
          duplicateForeshadowId: value.duplicateForeshadowId,
          reason: value.reason,
        },
      }
    }
    case 'foreshadow-fulfill': {
      if (!isMachineReadableId(value.foreshadowId)) {
        return invalid('foreshadow-fulfill.foreshadowId must be an identifier')
      }
      return {
        ok: true,
        normalized: base.normalized,
        event: {
          ...eventBase(base),
          type: value.type,
          foreshadowId: value.foreshadowId,
        },
      }
    }
    case 'task-create': {
      if (!isMachineReadableId(value.taskId)) {
        return invalid('task-create.taskId must be an identifier')
      }
      if (!isNonEmptyString(value.description)) {
        return invalid('task-create.description must be a non-empty string')
      }
      return {
        ok: true,
        normalized: base.normalized,
        event: {
          ...eventBase(base),
          type: value.type,
          taskId: value.taskId,
          description: value.description,
        },
      }
    }
    case 'task-resolve': {
      if (!isMachineReadableId(value.taskId)) {
        return invalid('task-resolve.taskId must be an identifier')
      }
      return {
        ok: true,
        normalized: base.normalized,
        event: {
          ...eventBase(base),
          type: value.type,
          taskId: value.taskId,
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
