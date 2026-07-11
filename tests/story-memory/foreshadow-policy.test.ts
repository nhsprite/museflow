import { describe, expect, it } from 'vitest'
import {
  classifyForeshadows,
  getBoundaryBlockingForeshadows,
  isValidForeshadowDeadline,
} from '../../src/story-memory/foreshadow-policy.js'
import type { ForeshadowItem } from '../../src/types/foreshadow.js'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import type { StoryArc } from '../../src/types/outline.js'
import type { StoryMemory } from '../../src/types/story-memory.js'

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

  it('separates required overdue, optional, invalid, and fulfilled items', () => {
    const buckets = classifyForeshadows(
      [
        item({ id: 'required-overdue', expectedFulfillChapter: 5 }),
        item({ id: 'optional-overdue', expectedFulfillChapter: 5, required: false }),
        item({ id: 'invalid', expectedFulfillChapter: 0 }),
        item({ id: 'fulfilled', expectedFulfillChapter: 5, fulfilledChapter: 6 }),
      ],
      10
    )

    expect(buckets.overdueRequired.map((entry) => entry.id)).toEqual(['required-overdue'])
    expect(buckets.optional.map((entry) => entry.id)).toEqual(['optional-overdue'])
    expect(buckets.invalid.map((entry) => entry.id)).toEqual(['invalid'])
    expect(buckets.dueRequired).toEqual([])
    expect(buckets.normalRequired).toEqual([])
  })

  it('blocks only required unresolved foreshadows linked to the current act at its boundary', () => {
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        'fs-act-1': memoryForeshadow('fs-act-1', 'beat-act-1'),
        'fs-act-2': memoryForeshadow('fs-act-2', 'beat-act-2'),
        'fs-optional': memoryForeshadow('fs-optional', 'beat-act-1', false),
        'fs-unbound': memoryForeshadow('fs-unbound', null),
      },
      beats: {
        'beat-act-1': memoryBeat('beat-act-1', 1),
        'beat-act-2': memoryBeat('beat-act-2', 2),
      },
    }
    const storyArc = arc()

    expect(getBoundaryBlockingForeshadows(memory, storyArc, 1, false)).toEqual(['fs-act-1'])
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

    expect(getBoundaryBlockingForeshadows(memory, arc(), 2, true)).toEqual([
      'fs-act-1',
      'fs-act-2',
      'fs-unbound',
    ])
  })
})

function memoryForeshadow(id: string, beatId: string | null, required = true) {
  return {
    id,
    text: id,
    kind: null,
    introducedIn: 0,
    expectedFulfillChapter: 3,
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

function arc(): StoryArc {
  return {
    totalChapters: 4,
    acts: [
      {
        index: 1,
        startChapter: 1,
        endChapter: 2,
        title: '第一幕',
        theme: '',
        function: '',
        mandatoryBeats: [],
      },
      {
        index: 2,
        startChapter: 3,
        endChapter: 4,
        title: '第二幕',
        theme: '',
        function: '',
        mandatoryBeats: [],
      },
    ],
    keyBeats: [],
  }
}
