import { describe, expect, it } from 'vitest'
import {
  calculateMinimumForeshadowsToFulfillNow,
  classifyForeshadows,
  groupActiveForeshadowsByPolicy,
  getBoundaryBlockingForeshadowDetails,
  getBoundaryBlockingForeshadows,
  getRequiredForeshadowsForScheduling,
  isValidForeshadowDeadline,
  normalizeForeshadowHeadroom,
  projectForeshadowStack,
  selectForeshadowsForChapter,
  selectOpportunisticForeshadowsForChapter,
} from '../../src/story-memory/foreshadow-policy.js'
import type { ForeshadowItem } from '../../src/types/foreshadow.js'
import { applyEvents, createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import type { StoryEvent, StoryMemory } from '../../src/types/story-memory.js'
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
  it('projects only canonical non-waived foreshadows into the legacy stack', () => {
    const events: StoryEvent[] = [
      {
        id: 'introduce-root',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-root',
        text: 'canonical obligation',
        expectedFulfillChapter: 6,
        resolutionPolicy: 'must_resolve',
        chapterIndex: 0,
        source: 'outline',
      },
      {
        id: 'introduce-alias',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-alias',
        text: 'duplicate obligation',
        expectedFulfillChapter: 6,
        resolutionPolicy: 'must_resolve',
        chapterIndex: 1,
        source: 'outline',
      },
      {
        id: 'introduce-waived',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-waived',
        text: 'waived obligation',
        expectedFulfillChapter: null,
        resolutionPolicy: 'may_remain_open',
        chapterIndex: 1,
        source: 'outline',
      },
      {
        id: 'merge-alias',
        type: 'foreshadow-merge',
        canonicalForeshadowId: 'fs-root',
        duplicateForeshadowId: 'fs-alias',
        reason: 'same obligation',
        chapterIndex: 2,
        source: 'outline',
      },
      {
        id: 'waive-record',
        type: 'foreshadow-waive',
        foreshadowId: 'fs-waived',
        chapterIndex: 2,
        source: 'outline',
      },
    ]
    const memory = applyEvents(createEmptyStoryMemory(), events)

    expect(projectForeshadowStack(memory).map((entry) => entry.id)).toEqual(['fs-root'])
  })

  it('groups only active, non-waived foreshadows by resolution policy', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        hard: policyForeshadow('hard', 'must_resolve', 10),
        soft: policyForeshadow('soft', 'should_resolve', null),
        ambient: policyForeshadow('ambient', 'may_remain_open', null),
        fulfilled: {
          ...policyForeshadow('fulfilled', 'should_resolve', null),
          fulfilledIn: 4,
        },
        waived: { ...policyForeshadow('waived', 'should_resolve', null), waivedIn: 4 },
      },
    }

    const groups = groupActiveForeshadowsByPolicy(memory)

    expect(groups.mustResolve.map((entry) => entry.id)).toEqual(['hard'])
    expect(groups.shouldResolve.map((entry) => entry.id)).toEqual(['soft'])
    expect(groups.mayRemainOpen.map((entry) => entry.id)).toEqual(['ambient'])
  })

  it('uses only must_resolve clues for story-end boundary pressure', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        hard: policyForeshadow('hard', 'must_resolve', 10),
        soft: policyForeshadow('soft', 'should_resolve', null),
        ambient: policyForeshadow('ambient', 'may_remain_open', null),
      },
    }

    expect(getBoundaryBlockingForeshadows(memory, 10, true)).toEqual(['hard'])
    expect(getRequiredForeshadowsForScheduling(memory, 10, true).map((entry) => entry.id)).toEqual([
      'hard',
    ])
  })

  it('fills opportunity capacity with should_resolve before ambient clues', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        'should-new': policyForeshadow('should-new', 'should_resolve', null),
        'should-recent': policyForeshadow('should-recent', 'should_resolve', null),
        'ambient-new': policyForeshadow('ambient-new', 'may_remain_open', null),
      },
    }

    expect(
      selectOpportunisticForeshadowsForChapter(memory, {
        chapterNumber: 5,
        minFulfillDistance: 2,
        capacity: 3,
        lastConsideredChapterById: new Map([['should-recent', 4]]),
      })
    ).toEqual(['should-new', 'should-recent', 'ambient-new'])
  })

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
        item({
          id: 'optional-overdue',
          expectedFulfillChapter: Number.MAX_SAFE_INTEGER,
          resolutionPolicy: 'may_remain_open',
          required: false,
        }),
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

  it('classifies legacy-stack alerts by resolutionPolicy instead of required', () => {
    const buckets = classifyForeshadows(
      [
        item({
          id: 'ambient',
          expectedFulfillChapter: Number.MAX_SAFE_INTEGER,
          resolutionPolicy: 'may_remain_open',
          required: true,
        } as Partial<ForeshadowItem>),
      ],
      10
    )

    expect(buckets.optional.map((entry) => entry.id)).toEqual(['ambient'])
    expect(buckets.normalRequired).toEqual([])
  })

  it('uses explicit fulfillment chapters instead of beat ownership at act boundaries', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        due: memoryForeshadow('due', 'beat-act-1', true, 2),
        future: memoryForeshadow('future', 'beat-act-1', true, 4),
        unscheduled: memoryForeshadow('unscheduled', 'beat-act-1', true, null),
        optional: policyForeshadow('optional', 'may_remain_open', null),
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

  it('returns structured boundary blockers in scheduling order', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        later: memoryForeshadow('later', null, true, 4),
        future: memoryForeshadow('future', null, true, 5),
        earlier: memoryForeshadow('earlier', null, true, 2),
        optional: policyForeshadow('optional', 'may_remain_open', null),
        fulfilled: { ...memoryForeshadow('fulfilled', null, true, 2), fulfilledIn: 1 },
      },
    }

    expect(
      getBoundaryBlockingForeshadowDetails(memory, 4, false).map((entry) => [
        entry.id,
        entry.expectedFulfillChapter,
      ])
    ).toEqual([
      ['earlier', 2],
      ['later', 4],
    ])
  })

  it('blocks every required unresolved foreshadow at story end', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        'fs-act-1': memoryForeshadow('fs-act-1', 'beat-act-1'),
        'fs-act-2': memoryForeshadow('fs-act-2', 'beat-act-2'),
        'fs-unbound': memoryForeshadow('fs-unbound', null),
        'fs-optional': policyForeshadow('fs-optional', 'may_remain_open', null),
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
        optional: policyForeshadow('optional', 'may_remain_open', null),
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

  it('normalizes planning headroom below the hard per-chapter capacity', () => {
    expect(normalizeForeshadowHeadroom(3, 1)).toBe(1)
    expect(normalizeForeshadowHeadroom(3, 9)).toBe(2)
    expect(normalizeForeshadowHeadroom(1, 1)).toBe(0)
    expect(normalizeForeshadowHeadroom(3, -1)).toBe(0)
    expect(normalizeForeshadowHeadroom(3, Number.NaN)).toBe(0)
  })

  it('requires only the minimum share needed to preserve future planning headroom', () => {
    expect(
      calculateMinimumForeshadowsToFulfillNow({
        pendingBlockingCount: 3,
        remainingChapters: 2,
        hardCapacity: 3,
        headroomPerChapter: 1,
      })
    ).toBe(1)
    expect(
      calculateMinimumForeshadowsToFulfillNow({
        pendingBlockingCount: 3,
        remainingChapters: 1,
        hardCapacity: 3,
        headroomPerChapter: 1,
      })
    ).toBe(3)
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
    ])
  })

  it('keeps a null-deadline soft clue out of mandatory ordering', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        'a-unscheduled': {
          ...memoryForeshadow('a-unscheduled', null, true, null),
          introducedIn: 0,
        },
        'z-finite': {
          ...memoryForeshadow('z-finite', null, true, Number.MAX_SAFE_INTEGER),
          introducedIn: 5,
        },
      },
    }

    expect(getRequiredForeshadowsForScheduling(memory, 20, true).map((entry) => entry.id)).toEqual([
      'z-finite',
    ])
  })

  it('orders equal-priority IDs by locale-independent code units', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        éclair: memoryForeshadow('éclair', null, true, 5),
        apple: memoryForeshadow('apple', null, true, 5),
        Zoo: memoryForeshadow('Zoo', null, true, 5),
        Äther: memoryForeshadow('Äther', null, true, 5),
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

  it('reserves one foreshadow slot of planning headroom by default', () => {
    expect(DEFAULT_CHAPTER_PLANNING_CONFIG.foreshadowFulfillmentHeadroomPerChapter).toBe(1)
  })

  it('defaults per-chapter opportunistic foreshadow capacity to one', () => {
    expect(DEFAULT_CHAPTER_PLANNING_CONFIG.foreshadowMaxOpportunisticCandidatesPerChapter).toBe(1)
  })

  it('selects only eligible active null-deadline foreshadows as natural opportunities', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        'eligible-required': {
          ...memoryForeshadow('eligible-required', null, true, null),
          introducedIn: 1,
        },
        'eligible-optional': {
          ...memoryForeshadow('eligible-optional', null, false, null),
          introducedIn: 0,
        },
        'too-young': {
          ...memoryForeshadow('too-young', null, true, null),
          introducedIn: 3,
        },
        finite: memoryForeshadow('finite', null, true, 8),
        fulfilled: {
          ...memoryForeshadow('fulfilled', null, true, null),
          fulfilledIn: 3,
        },
        waived: {
          ...memoryForeshadow('waived', null, true, null),
          waivedIn: 3,
        },
        excluded: memoryForeshadow('excluded', null, true, null),
      },
    }

    expect(
      selectOpportunisticForeshadowsForChapter(memory, {
        chapterNumber: 5,
        minFulfillDistance: 2,
        capacity: 3,
        excludedIds: new Set(['excluded']),
      })
    ).toEqual(['eligible-required', 'eligible-optional'])
  })

  it('rotates never-considered opportunities ahead of recently considered required clues', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        'required-never': memoryForeshadow('required-never', null, true, null),
        'optional-never': memoryForeshadow('optional-never', null, false, null),
        'required-recent': memoryForeshadow('required-recent', null, true, null),
      },
    }

    expect(
      selectOpportunisticForeshadowsForChapter(memory, {
        chapterNumber: 5,
        minFulfillDistance: 2,
        capacity: 3,
        lastConsideredChapterById: new Map([['required-recent', 4]]),
      })
    ).toEqual(['required-never', 'required-recent', 'optional-never'])
  })

  it('allows zero opportunistic capacity and floors positive fractional capacity', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        first: memoryForeshadow('first', null, true, null),
        second: memoryForeshadow('second', null, true, null),
      },
    }

    expect(
      selectOpportunisticForeshadowsForChapter(memory, {
        chapterNumber: 5,
        minFulfillDistance: 2,
        capacity: 0,
      })
    ).toEqual([])
    expect(
      selectOpportunisticForeshadowsForChapter(memory, {
        chapterNumber: 5,
        minFulfillDistance: 2,
        capacity: 1.9,
      })
    ).toEqual(['first'])
  })

  it('excludes waived foreshadows from scheduling and boundary blocking', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        active: memoryForeshadow('active', null, true, 2),
        waived: { ...memoryForeshadow('waived', null, true, 2), waivedIn: 5 },
      },
    }

    expect(getRequiredForeshadowsForScheduling(memory, 10, true).map((f) => f.id)).toEqual([
      'active',
    ])
    expect(selectForeshadowsForChapter(memory, 10, 3, true)).toEqual(['active'])
    expect(getBoundaryBlockingForeshadows(memory, 10, true)).toEqual(['active'])
    expect(getBoundaryBlockingForeshadowDetails(memory, 10, true).map((f) => f.id)).toEqual([
      'active',
    ])
  })
})

function memoryForeshadow(
  id: string,
  beatId: string | null,
  required = true,
  expectedFulfillChapter: number | null = 3
) {
  const resolutionPolicy =
    expectedFulfillChapter !== null
      ? ('must_resolve' as const)
      : required
        ? ('should_resolve' as const)
        : ('may_remain_open' as const)
  return {
    id,
    text: id,
    kind: null,
    introducedIn: 0,
    expectedFulfillChapter,
    fulfilledIn: null,
    resolutionPolicy,
    required: resolutionPolicy !== 'may_remain_open',
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

function policyForeshadow(
  id: string,
  resolutionPolicy: 'must_resolve' | 'should_resolve' | 'may_remain_open',
  expectedFulfillChapter: number | null
) {
  return {
    id,
    text: id,
    kind: null,
    introducedIn: 0,
    expectedFulfillChapter,
    fulfilledIn: null,
    resolutionPolicy,
    required: resolutionPolicy !== 'may_remain_open',
    beatId: null,
  }
}
