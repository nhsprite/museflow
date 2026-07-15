import { describe, expect, it } from 'vitest'
import type {
  ForeshadowId,
  ForeshadowMemory,
  StoryEvent,
  StoryMemory,
} from '../../src/types/story-memory.js'
import {
  canonicalizeForeshadowIds,
  compareCanonicalOrder,
  getCanonicalForeshadows,
  resolveCanonicalForeshadowId,
} from '../../src/story-memory/foreshadow-alias.js'
import { applyEvents, createEmptyStoryMemory } from '../../src/story-memory/projector.js'

type ForeshadowIntroduceEvent = Extract<StoryEvent, { type: 'foreshadow-introduce' }>
type ForeshadowMergeEvent = Extract<StoryEvent, { type: 'foreshadow-merge' }>

function introduceEvent(
  foreshadowId: ForeshadowId,
  chapterIndex: number,
  id = `introduce-${foreshadowId}`
): ForeshadowIntroduceEvent {
  return {
    id,
    type: 'foreshadow-introduce',
    foreshadowId,
    text: 'A sealed record has an unexplained mark',
    expectedFulfillChapter: null,
    resolutionPolicy: 'should_resolve',
    chapterIndex,
    source: 'outline',
  }
}

function mergeEvent(
  canonicalForeshadowId: ForeshadowId,
  duplicateForeshadowId: ForeshadowId,
  id = `merge-${canonicalForeshadowId}-${duplicateForeshadowId}`
): ForeshadowMergeEvent {
  return {
    id,
    type: 'foreshadow-merge',
    canonicalForeshadowId,
    duplicateForeshadowId,
    reason: 'The records describe one obligation',
    chapterIndex: 4,
    source: 'outline',
  }
}

function memoryWithIntroductions(...ids: ForeshadowId[]): StoryMemory {
  return applyEvents(
    createEmptyStoryMemory(),
    ids.map((id, index) => introduceEvent(id, 1, `introduce-${index}`))
  )
}

function projectedForeshadow(id: ForeshadowId, introducedIn: number): ForeshadowMemory {
  return {
    id,
    text: id,
    kind: null,
    introducedIn,
    expectedFulfillChapter: null,
    fulfilledIn: null,
    resolutionPolicy: 'should_resolve',
    required: true,
    beatId: null,
  }
}

describe('foreshadow aliases', () => {
  it('resolves a direct merge to its canonical record', () => {
    const memory = memoryWithIntroductions('fs-early', 'fs-late')
    const merged = applyEvents(memory, [mergeEvent('fs-early', 'fs-late')])

    expect(resolveCanonicalForeshadowId(merged, 'fs-early')).toBe('fs-early')
    expect(resolveCanonicalForeshadowId(merged, 'fs-late')).toBe('fs-early')
    expect(merged.foreshadows['fs-late']?.mergedInto).toBe('fs-early')
  })

  it('flattens a valid alias chain to the root canonical record', () => {
    const memory = memoryWithIntroductions('fs-early', 'fs-middle', 'fs-late')
    const merged = applyEvents(memory, [
      mergeEvent('fs-early', 'fs-middle'),
      mergeEvent('fs-middle', 'fs-late'),
    ])

    expect(resolveCanonicalForeshadowId(merged, 'fs-late')).toBe('fs-early')
    expect(merged.foreshadows['fs-middle']?.mergedInto).toBe('fs-early')
    expect(merged.foreshadows['fs-late']?.mergedInto).toBe('fs-early')
    expect(getCanonicalForeshadows(merged).map((item) => item.id)).toEqual(['fs-early'])
  })

  it('returns canonical records in deterministic introduction order', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      introduceEvent('fs-later-chapter', 3),
      introduceEvent('fs-first-position', 1),
      introduceEvent('fs-second-position', 1),
    ])

    expect(getCanonicalForeshadows(memory).map((item) => item.id)).toEqual([
      'fs-first-position',
      'fs-second-position',
      'fs-later-chapter',
    ])
  })

  it('uses the first introduction for ordering when an id is introduced again', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      introduceEvent('fs-first', 2, 'introduce-first'),
      introduceEvent('fs-second', 2, 'introduce-second'),
      introduceEvent('fs-second', 1, 'introduce-second-again'),
    ])

    expect(compareCanonicalOrder(memory, 'fs-first', 'fs-second')).toBeLessThan(0)
    expect(getCanonicalForeshadows(memory).map((item) => item.id)).toEqual([
      'fs-first',
      'fs-second',
    ])
  })

  it('uses the first projectable introduction when an earlier introduction is invalid', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        ...introduceEvent('fs-later-valid', 0, 'introduce-invalid'),
        resolutionPolicy: 'must_resolve',
        expectedFulfillChapter: 1,
      },
      introduceEvent('fs-earlier-valid', 1, 'introduce-earlier-valid'),
      introduceEvent('fs-later-valid', 2, 'introduce-later-valid'),
    ])

    expect(compareCanonicalOrder(memory, 'fs-earlier-valid', 'fs-later-valid')).toBeLessThan(0)
    expect(getCanonicalForeshadows(memory).map((item) => item.id)).toEqual([
      'fs-earlier-valid',
      'fs-later-valid',
    ])
  })

  it('uses lexical ids as the final deterministic ordering tie-breaker', () => {
    const memory = createEmptyStoryMemory()
    memory.foreshadows = {
      'fs-zeta': projectedForeshadow('fs-zeta', 2),
      'fs-alpha': projectedForeshadow('fs-alpha', 2),
    }

    expect(compareCanonicalOrder(memory, 'fs-alpha', 'fs-zeta')).toBeLessThan(0)
    expect(getCanonicalForeshadows(memory).map((item) => item.id)).toEqual(['fs-alpha', 'fs-zeta'])
  })

  it('canonicalizes exact ids once while preserving first input occurrence order', () => {
    const memory = memoryWithIntroductions('fs-early', 'fs-middle', 'fs-other')
    const merged = applyEvents(memory, [mergeEvent('fs-early', 'fs-middle')])

    expect(
      canonicalizeForeshadowIds(merged, [
        'fs-middle',
        'fs-unknown',
        'fs-early',
        'fs-other',
        'fs-middle',
      ])
    ).toEqual(['fs-early', 'fs-other'])
  })

  it('returns null and omits ids for unknown or cyclic alias chains', () => {
    const memory = createEmptyStoryMemory()
    memory.foreshadows = {
      'fs-left': { ...projectedForeshadow('fs-left', 1), mergedInto: 'fs-right' },
      'fs-right': { ...projectedForeshadow('fs-right', 2), mergedInto: 'fs-left' },
      'fs-broken': { ...projectedForeshadow('fs-broken', 3), mergedInto: 'fs-missing' },
    }

    expect(resolveCanonicalForeshadowId(memory, 'fs-unknown')).toBeNull()
    expect(resolveCanonicalForeshadowId(memory, 'fs-left')).toBeNull()
    expect(resolveCanonicalForeshadowId(memory, 'fs-broken')).toBeNull()
    expect(canonicalizeForeshadowIds(memory, ['fs-left', 'fs-broken', 'fs-unknown'])).toEqual([])
    expect(getCanonicalForeshadows(memory)).toEqual([])
  })
})
