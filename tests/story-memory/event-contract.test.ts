import { describe, expect, it } from 'vitest'
import { normalizeStoryEvent, normalizeStoryEvents } from '../../src/story-memory/event-contract.js'

describe('normalizeStoryEvent', () => {
  it('requires resolutionPolicy on strict foreshadow introductions', () => {
    const result = normalizeStoryEvent(
      {
        id: 'evt-strict-foreshadow',
        type: 'foreshadow-introduce',
        foreshadowId: 'foreshadow-1',
        expectedFulfillChapter: 3,
        chapterIndex: 0,
        source: 'chapter',
      },
      { chapterIndex: 0, mode: 'strict' }
    )

    expect(result).toEqual({
      ok: false,
      reason: 'foreshadow-introduce.resolutionPolicy is required in strict mode',
    })
  })

  it('normalizes a legacy null-deadline required clue to should_resolve', () => {
    const result = normalizeStoryEvent(
      {
        id: 'evt-legacy-foreshadow',
        type: 'foreshadow-introduce',
        foreshadowId: 'foreshadow-legacy',
        expectedFulfillChapter: null,
        required: true,
        chapterIndex: 4,
      },
      { chapterIndex: 4, mode: 'legacy' }
    )

    expect(result).toEqual({
      ok: true,
      normalized: true,
      event: {
        id: 'evt-legacy-foreshadow',
        type: 'foreshadow-introduce',
        foreshadowId: 'foreshadow-legacy',
        expectedFulfillChapter: null,
        resolutionPolicy: 'should_resolve',
        required: true,
        chapterIndex: 4,
        source: 'chapter',
      },
    })
  })

  it('normalizes a legacy optional finite-deadline clue to an open clue without a deadline', () => {
    const result = normalizeStoryEvent(
      {
        id: 'evt-legacy-optional-foreshadow',
        type: 'foreshadow-introduce',
        foreshadowId: 'foreshadow-legacy-optional',
        expectedFulfillChapter: 12,
        required: false,
        chapterIndex: 4,
      },
      { chapterIndex: 4, mode: 'legacy' }
    )

    expect(result).toEqual({
      ok: true,
      normalized: true,
      event: {
        id: 'evt-legacy-optional-foreshadow',
        type: 'foreshadow-introduce',
        foreshadowId: 'foreshadow-legacy-optional',
        expectedFulfillChapter: null,
        resolutionPolicy: 'may_remain_open',
        required: false,
        chapterIndex: 4,
        source: 'chapter',
      },
    })
  })

  it('rejects an explicit open policy with a finite deadline in strict mode', () => {
    const result = normalizeStoryEvent(
      {
        id: 'evt-invalid-open-deadline',
        type: 'foreshadow-introduce',
        foreshadowId: 'foreshadow-open',
        expectedFulfillChapter: 12,
        resolutionPolicy: 'may_remain_open',
        chapterIndex: 4,
        source: 'chapter',
      },
      { chapterIndex: 4, mode: 'strict' }
    )

    expect(result).toEqual({
      ok: false,
      reason: 'foreshadow-introduce policy and deadline are inconsistent',
    })
  })

  it('rejects a deadline-free must_resolve introduction', () => {
    const result = normalizeStoryEvent(
      {
        id: 'evt-invalid-mandatory',
        type: 'foreshadow-introduce',
        foreshadowId: 'foreshadow-mandatory',
        expectedFulfillChapter: null,
        resolutionPolicy: 'must_resolve',
        chapterIndex: 0,
        source: 'chapter',
      },
      { chapterIndex: 0, mode: 'strict' }
    )

    expect(result).toEqual({
      ok: false,
      reason: 'foreshadow-introduce policy and deadline are inconsistent',
    })
  })

  it('normalizes a valid foreshadow-policy-set event', () => {
    const event = {
      id: 'evt-policy-set',
      type: 'foreshadow-policy-set',
      foreshadowId: 'foreshadow-1',
      resolutionPolicy: 'must_resolve',
      expectedFulfillChapter: 12,
      chapterIndex: 4,
      source: 'outline',
    }

    expect(normalizeStoryEvent(event, { chapterIndex: 4, mode: 'strict' })).toEqual({
      ok: true,
      normalized: false,
      event,
    })
  })

  it('rejects strict item-location events without an explicit holder field', () => {
    const result = normalizeStoryEvent(
      {
        id: 'evt-1',
        type: 'item-location',
        itemId: 'item-1',
        locationId: 'loc-1',
        chapterIndex: 0,
        source: 'chapter',
      },
      { chapterIndex: 0, mode: 'strict' }
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('holderId')
  })

  it('rejects state-only item-state events', () => {
    const result = normalizeStoryEvent(
      {
        id: 'evt-2',
        type: 'item-state',
        itemId: 'item-1',
        state: 'closed',
        chapterIndex: 0,
        source: 'chapter',
      },
      { chapterIndex: 0, mode: 'strict' }
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('attribute')
  })

  it('normalizes a legacy item location with a location but no holder', () => {
    const result = normalizeStoryEvent(
      {
        id: 'evt-legacy',
        type: 'item-location',
        itemId: 'item-1',
        locationId: 'loc-1',
        chapterIndex: 26,
      },
      { chapterIndex: 25, mode: 'legacy' }
    )

    expect(result).toEqual({
      ok: true,
      normalized: true,
      event: {
        id: 'evt-legacy',
        type: 'item-location',
        itemId: 'item-1',
        holderId: null,
        locationId: 'loc-1',
        chapterIndex: 25,
        source: 'chapter',
      },
    })
  })

  it('does not guess an attribute for a legacy state-only item event', () => {
    const result = normalizeStoryEvent(
      {
        id: 'evt-legacy-state',
        type: 'item-state',
        itemId: 'item-1',
        state: 'closed',
        chapterIndex: 0,
      },
      { chapterIndex: 0, mode: 'legacy' }
    )

    expect(result.ok).toBe(false)
  })

  it('preserves valid paragraph evidence', () => {
    const event = {
      id: 'evt-with-evidence',
      type: 'task-resolve',
      taskId: 'task-1',
      chapterIndex: 0,
      source: 'chapter',
      evidence: { paragraphIndex: 2 },
    }

    const result = normalizeStoryEvent(event, { chapterIndex: 0, mode: 'strict' })

    expect(result).toEqual({ ok: true, event, normalized: false })
  })

  it('rejects malformed paragraph evidence', () => {
    const result = normalizeStoryEvent(
      {
        id: 'evt-bad-evidence',
        type: 'task-resolve',
        taskId: 'task-1',
        chapterIndex: 0,
        source: 'chapter',
        evidence: { paragraphIndex: 0 },
      },
      { chapterIndex: 0, mode: 'strict' }
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('evidence.paragraphIndex')
  })

  it.each([
    {
      id: 'evt-character-location',
      type: 'character-location',
      characterId: 'character-1',
      locationId: 'location-1',
      chapterIndex: 0,
      source: 'chapter',
    },
    {
      id: 'evt-character-status',
      type: 'character-status',
      characterId: 'character-1',
      attribute: 'mood',
      value: 'calm',
      chapterIndex: 0,
      source: 'chapter',
    },
    {
      id: 'evt-item-location',
      type: 'item-location',
      itemId: 'item-1',
      holderId: null,
      locationId: 'location-1',
      chapterIndex: 0,
      source: 'chapter',
    },
    {
      id: 'evt-item-state',
      type: 'item-state',
      itemId: 'item-1',
      attribute: 'sealed',
      value: true,
      chapterIndex: 0,
      source: 'chapter',
    },
    {
      id: 'evt-plot',
      type: 'plot-advance',
      plotId: 'plot-1',
      beatId: 'beat-1',
      chapterIndex: 0,
      source: 'chapter',
    },
    {
      id: 'evt-foreshadow-introduce',
      type: 'foreshadow-introduce',
      foreshadowId: 'foreshadow-1',
      expectedFulfillChapter: 3,
      resolutionPolicy: 'must_resolve',
      text: 'A visible clue',
      kind: 'object_foreshadow',
      required: true,
      beatId: 'beat-1',
      chapterIndex: 0,
      source: 'chapter',
    },
    {
      id: 'evt-foreshadow-fulfill',
      type: 'foreshadow-fulfill',
      foreshadowId: 'foreshadow-1',
      chapterIndex: 0,
      source: 'chapter',
    },
    {
      id: 'evt-task-create',
      type: 'task-create',
      taskId: 'task-1',
      description: 'Check the archive',
      chapterIndex: 0,
      source: 'chapter',
    },
    {
      id: 'evt-task-resolve',
      type: 'task-resolve',
      taskId: 'task-1',
      chapterIndex: 0,
      source: 'chapter',
    },
  ])('accepts a valid $type event', (event) => {
    const result = normalizeStoryEvent(event, { chapterIndex: 0, mode: 'strict' })

    expect(result).toEqual({ ok: true, event, normalized: false })
  })

  it('reports every invalid event without admitting partial objects', () => {
    const result = normalizeStoryEvents(
      [
        {
          id: 'evt-valid',
          type: 'task-resolve',
          taskId: 'task-1',
          chapterIndex: 0,
          source: 'chapter',
        },
        {
          id: 'evt-invalid',
          type: 'item-state',
          itemId: 'item-1',
          chapterIndex: 0,
          source: 'chapter',
        },
      ],
      { chapterIndex: 0, mode: 'strict' }
    )

    expect(result.events).toHaveLength(1)
    expect(result.invalid).toEqual([
      { index: 1, reason: 'item-state.attribute must be a non-empty string' },
    ])
  })
})
