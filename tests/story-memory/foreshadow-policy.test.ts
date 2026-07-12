import { describe, expect, it } from 'vitest'
import {
  classifyForeshadows,
  getBoundaryBlockingForeshadows,
  getRequiredForeshadowsForScheduling,
  isValidForeshadowDeadline,
  selectForeshadowsForChapter,
} from '../../src/story-memory/foreshadow-policy.js'
import type { ForeshadowItem } from '../../src/types/foreshadow.js'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import type { StoryMemory } from '../../src/types/story-memory.js'
import { DEFAULT_CHAPTER_PLANNING_CONFIG } from '../../src/utils/chapter-planning.js'

function item(overrides: Partial<ForeshadowItem> = {}): ForeshadowItem {
  return {
    id: 'fs-default',
    text: '结构化伏笔',
    expectedFulfillChapter: 5,
    createdAt: 0,
    createdAtChapter: 1,
    status: 'planted',
    isExplicit: true,
    required: true,
    ...overrides,
  }
}

describe('foreshadow deadline policy', () => {
  it('accepts only null or a 1-based deadline after the introduction chapter', () => {
    expect(isValidForeshadowDeadline(9, 0)).toBe(false)
    expect(isValidForeshadowDeadline(9, 10)).toBe(false)
    expect(isValidForeshadowDeadline(9, 11)).toBe(true)
    expect(isValidForeshadowDeadline(9, null)).toBe(true)
    expect(isValidForeshadowDeadline(9, 11.5)).toBe(false)
  })

  it('separates required overdue, optional, and fulfilled items, skipping invalid deadlines', () => {
    const buckets = classifyForeshadows(
      [
        item({ id: 'required-overdue', expectedFulfillChapter: 5 }),
        item({ id: 'optional-overdue', expectedFulfillChapter: 5, required: false }),
        item({ id: 'invalid', expectedFulfillChapter: 0 }),
        item({ id: 'next-chapter-deadline', expectedFulfillChapter: 2 }),
        item({ id: 'fulfilled', expectedFulfillChapter: 5, fulfilledChapter: 6 }),
      ],
      10
    )

    expect(buckets.overdueRequired.map((entry) => entry.id)).toEqual(['required-overdue'])
    expect(buckets.optional.map((entry) => entry.id)).toEqual(['optional-overdue'])
    expect(buckets.dueRequired).toEqual([])
    expect(buckets.normalRequired).toEqual([])
  })

  it('uses explicit fulfillment chapters instead of beat ownership at act boundaries', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        due: memoryForeshadow('due', 'beat-act-1', true, 2),
        future: memoryForeshadow('future', 'beat-act-1', true, 4),
        unscheduled: memoryForeshadow('unscheduled', 'beat-act-1', true, null),
        optional: memoryForeshadow('optional', 'beat-act-1', false, 2),
        fulfilled: {
          ...memoryForeshadow('fulfilled', 'beat-act-1', true, 2),
          fulfilledIn: 1,
        },
      },
      beats: {
        'beat-act-1': memoryBeat('beat-act-1', 1),
      },
    }

    expect(getBoundaryBlockingForeshadows(memory, 2, false)).toEqual(['due'])
  })

  it('blocks every required unresolved foreshadow at story end', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        'fs-act-1': memoryForeshadow('fs-act-1', 'beat-act-1'),
        'fs-act-2': memoryForeshadow('fs-act-2', 'beat-act-2'),
        'fs-unbound': memoryForeshadow('fs-unbound', null),
        'fs-optional': memoryForeshadow('fs-optional', null, false),
      },
      beats: {
        'beat-act-1': memoryBeat('beat-act-1', 1),
        'beat-act-2': memoryBeat('beat-act-2', 2),
      },
    }

    expect(getBoundaryBlockingForeshadows(memory, 4, true)).toEqual([
      'fs-act-1',
      'fs-act-2',
      'fs-unbound',
    ])
  })

  it('keeps ordinary boundary blocking uncapped', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        'due-a': memoryForeshadow('due-a', null, true, 2),
        'due-b': memoryForeshadow('due-b', null, true, 2),
        'due-c': memoryForeshadow('due-c', null, true, 2),
        'due-d': memoryForeshadow('due-d', null, true, 2),
      },
    }

    expect(getBoundaryBlockingForeshadows(memory, 2, false)).toEqual([
      'due-a',
      'due-b',
      'due-c',
      'due-d',
    ])
  })

  it('orders and caps due required foreshadows using structured fields', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        later: memoryForeshadow('later', null, true, 8),
        'same-b': { ...memoryForeshadow('same-b', null, true, 6), introducedIn: 2 },
        'same-a': { ...memoryForeshadow('same-a', null, true, 6), introducedIn: 2 },
        earlier: { ...memoryForeshadow('earlier', null, true, 6), introducedIn: 1 },
        future: memoryForeshadow('future', null, true, 9),
        unscheduled: memoryForeshadow('unscheduled', null, true, null),
        optional: memoryForeshadow('optional', null, false, 5),
        fulfilled: { ...memoryForeshadow('fulfilled', null, true, 5), fulfilledIn: 4 },
        invalid: { ...memoryForeshadow('invalid', null, true, 1), introducedIn: 0 },
      },
    }

    expect(getRequiredForeshadowsForScheduling(memory, 8, false).map((entry) => entry.id)).toEqual([
      'earlier',
      'same-a',
      'same-b',
      'later',
    ])
    expect(selectForeshadowsForChapter(memory, 8, 3, false)).toEqual([
      'earlier',
      'same-a',
      'same-b',
    ])
  })

  it('normalizes per-chapter scheduling capacity to a positive integer', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        first: memoryForeshadow('first', null, true, 3),
        second: memoryForeshadow('second', null, true, 4),
        third: memoryForeshadow('third', null, true, 5),
      },
    }

    expect(selectForeshadowsForChapter(memory, 5, 0, false)).toEqual(['first'])
    expect(selectForeshadowsForChapter(memory, 5, 2.9, false)).toEqual(['first', 'second'])
  })

  it('normalizes non-finite scheduling capacities to one', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        first: memoryForeshadow('first', null, true, 3),
        second: memoryForeshadow('second', null, true, 4),
        third: memoryForeshadow('third', null, true, 5),
      },
    }

    for (const capacity of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(selectForeshadowsForChapter(memory, 5, capacity, false)).toEqual(['first'])
    }
  })

  it('includes every valid required unresolved foreshadow in final-act scheduling', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        due: memoryForeshadow('due', null, true, 3),
        future: memoryForeshadow('future', null, true, 30),
        unscheduled: memoryForeshadow('unscheduled', null, true, null),
        optional: memoryForeshadow('optional', null, false, null),
        fulfilled: { ...memoryForeshadow('fulfilled', null, true, 4), fulfilledIn: 3 },
        invalid: { ...memoryForeshadow('invalid', null, true, 1), introducedIn: 0 },
      },
    }

    expect(getRequiredForeshadowsForScheduling(memory, 20, true).map((entry) => entry.id)).toEqual([
      'due',
      'future',
      'unscheduled',
    ])
  })

  it('orders an unscheduled foreshadow after the largest finite deadline', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        unscheduled: { ...memoryForeshadow('a-unscheduled', null, true, null), introducedIn: 0 },
        finite: {
          ...memoryForeshadow('z-finite', null, true, Number.MAX_SAFE_INTEGER),
          introducedIn: 5,
        },
      },
    }

    expect(getRequiredForeshadowsForScheduling(memory, 20, true).map((entry) => entry.id)).toEqual([
      'z-finite',
      'a-unscheduled',
    ])
  })

  it('orders equal-priority IDs by locale-independent code units', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        accentedLower: memoryForeshadow('éclair', null, true, 5),
        asciiLower: memoryForeshadow('apple', null, true, 5),
        asciiUpper: memoryForeshadow('Zoo', null, true, 5),
        accentedUpper: memoryForeshadow('Äther', null, true, 5),
      },
    }

    expect(getRequiredForeshadowsForScheduling(memory, 5, false).map((entry) => entry.id)).toEqual([
      'Zoo',
      'apple',
      'Äther',
      'éclair',
    ])
  })

  it('defaults per-chapter foreshadow scheduling capacity to three', () => {
    expect(DEFAULT_CHAPTER_PLANNING_CONFIG.foreshadowMaxFulfillmentsPerChapter).toBe(3)
  })
})

function memoryForeshadow(
  id: string,
  beatId: string | null,
  required = true,
  expectedFulfillChapter: number | null = 3
) {
  return {
    id,
    text: id,
    kind: null,
    introducedIn: 0,
    expectedFulfillChapter,
    fulfilledIn: null,
    required,
    beatId,
  }
}

function memoryBeat(id: string, actIndex: number) {
  return {
    id,
    description: id,
    actIndex,
    deadlineAct: actIndex,
    required: true,
    claimedIn: null,
    provenByEventIds: [],
  }
}
