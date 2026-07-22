import { describe, it, expect } from 'vitest'
import {
  getActiveForeshadows,
  getOverdueForeshadows,
  getUnprovenMandatoryBeats,
  getOpenTasks,
  getCharacterLocation,
  getItemHolder,
} from '../../src/story-memory/queries.js'
import { createEmptyStoryMemory, applyEvents } from '../../src/story-memory/projector.js'
import {
  getBoundaryBlockingForeshadowDetails,
  getMandatoryForeshadows,
  groupActiveForeshadowsByPolicy,
  selectOpportunityForeshadowsForChapter,
} from '../../src/story-memory/foreshadow-policy.js'
import type { StoryEvent } from '../../src/types/story-memory.js'
import type { StoryArc } from '../../src/types/outline.js'

function mergedForeshadowMemory(
  resolutionPolicy: 'must_resolve' | 'should_resolve' = 'must_resolve'
) {
  const expectedFulfillChapter = resolutionPolicy === 'must_resolve' ? 5 : null
  const events: StoryEvent[] = [
    {
      id: 'introduce-early',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-early',
      text: 'canonical planted text',
      resolutionPolicy,
      expectedFulfillChapter,
      chapterIndex: 1,
      source: 'outline',
    },
    {
      id: 'introduce-late',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-late',
      text: 'duplicate planted text',
      resolutionPolicy,
      expectedFulfillChapter,
      chapterIndex: 2,
      source: 'outline',
    },
    {
      id: 'merge-foreshadows',
      type: 'foreshadow-merge',
      canonicalForeshadowId: 'fs-early',
      duplicateForeshadowId: 'fs-late',
      reason: 'same structured obligation',
      chapterIndex: 3,
      source: 'outline',
    },
  ]
  return applyEvents(createEmptyStoryMemory(), events)
}

describe('queries', () => {
  it('returns one canonical pending obligation for a mandatory-covered key beat', () => {
    const memory = createEmptyStoryMemory()
    memory.beats['A1-M1'] = {
      id: 'A1-M1',
      description: '完成转折',
      actIndex: 1,
      deadlineAct: 1,
      required: true,
      claimedIn: null,
      provenByEventIds: [],
    }
    memory.beats['A1-B1'] = {
      id: 'A1-B1',
      description: '完成转折',
      actIndex: 1,
      deadlineAct: 1,
      required: true,
      claimedIn: null,
      provenByEventIds: [],
    }
    const storyArc: StoryArc = {
      totalChapters: 2,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 2,
          title: '第一幕',
          theme: '',
          function: '',
          mandatoryBeats: ['完成转折'],
        },
      ],
      keyBeats: [
        {
          id: 'A1-B1',
          beat: '完成转折',
          deadlineAct: 1,
          required: true,
          coveredByMandatoryBeatId: 'A1-M1',
        },
      ],
    }

    expect(getUnprovenMandatoryBeats(memory, storyArc)).toEqual(['A1-M1'])
  })

  it('returns active foreshadows', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-1',
        expectedFulfillChapter: 5,
        chapterIndex: 1,
        source: 'outline',
      },
    ])
    expect(getActiveForeshadows(memory)).toContain('f-1')
  })

  it('returns overdue foreshadows', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-1',
        expectedFulfillChapter: 3,
        chapterIndex: 1,
        source: 'outline',
      },
    ])
    memory.foreshadows['f-1']!.required = true
    expect(getOverdueForeshadows(memory, 5)).toContain('f-1')
  })

  it('returns only the canonical active and mandatory foreshadow obligation', () => {
    const memory = mergedForeshadowMemory()

    expect(getActiveForeshadows(memory)).toEqual(['fs-early'])
    expect(getMandatoryForeshadows(memory).map(({ id }) => id)).toEqual(['fs-early'])
    expect(getBoundaryBlockingForeshadowDetails(memory, 5, false).map(({ id }) => id)).toEqual([
      'fs-early',
    ])
    expect(groupActiveForeshadowsByPolicy(memory).mustResolve.map(({ id }) => id)).toEqual([
      'fs-early',
    ])
  })

  it('offers an aliased opportunity only once under its canonical ID', () => {
    const memory = mergedForeshadowMemory('should_resolve')

    expect(
      selectOpportunityForeshadowsForChapter(memory, {
        chapterNumber: 5,
        minFulfillDistance: 0,
        capacity: 3,
      }).map(({ foreshadow }) => foreshadow.id)
    ).toEqual(['fs-early'])
  })

  it('excludes waived foreshadows from active and overdue queries', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e-intro-waived',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-waived',
        expectedFulfillChapter: 3,
        chapterIndex: 1,
        source: 'outline',
      },
      {
        id: 'e-waive',
        type: 'foreshadow-waive',
        foreshadowId: 'f-waived',
        chapterIndex: 4,
        source: 'outline',
      },
    ])

    expect(getActiveForeshadows(memory)).not.toContain('f-waived')
    expect(getOverdueForeshadows(memory, 5)).not.toContain('f-waived')
  })

  it('does not treat a non-mandatory policy as overdue even if required is stale', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e-soft',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-soft',
        expectedFulfillChapter: 3,
        chapterIndex: 1,
        source: 'outline',
      },
    ])
    memory.foreshadows['f-soft']!.resolutionPolicy = 'should_resolve'
    memory.foreshadows['f-soft']!.required = true

    expect(getOverdueForeshadows(memory, 5)).not.toContain('f-soft')
  })

  it('returns unproven mandatory beats', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'plot-advance',
        plotId: 'p-1',
        beatId: 'a1-b1',
        chapterIndex: 1,
        source: 'chapter',
      },
    ])
    expect(getUnprovenMandatoryBeats(memory)).toEqual([])
  })

  it('returns unproven mandatory beats from direct beat', () => {
    const memory = createEmptyStoryMemory()
    memory.beats['a1-b1'] = {
      id: 'a1-b1',
      description: 'test beat',
      actIndex: 1,
      deadlineAct: 1,
      required: true,
      claimedIn: null,
      provenByEventIds: [],
    }
    expect(getUnprovenMandatoryBeats(memory)).toContain('a1-b1')
  })

  it('returns open tasks', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'task-create',
        taskId: 't-1',
        description: 'find key',
        chapterIndex: 1,
        source: 'chapter',
      },
    ])
    expect(getOpenTasks(memory)).toContain('t-1')
  })

  it('returns character location', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'l-1',
        chapterIndex: 1,
        source: 'chapter',
      },
    ])
    expect(getCharacterLocation(memory, 'c-1')).toBe('l-1')
  })

  it('returns item holder', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'item-location',
        itemId: 'i-1',
        holderId: 'c-1',
        locationId: null,
        chapterIndex: 1,
        source: 'chapter',
      },
    ])
    expect(getItemHolder(memory, 'i-1')).toBe('c-1')
  })
})

describe('queries — chapter index 0 fulfillment (falsy bug regression)', () => {
  it('excludes foreshadows fulfilled in the first chapter (fulfilledIn = 0)', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'foreshadow-introduce',
        foreshadowId: 'f-early',
        expectedFulfillChapter: 1,
        chapterIndex: 0,
        source: 'chapter',
      },
      {
        id: 'e2',
        type: 'foreshadow-fulfill',
        foreshadowId: 'f-early',
        chapterIndex: 0,
        source: 'chapter',
      },
    ])
    expect(getActiveForeshadows(memory)).not.toContain('f-early')
  })

  it('excludes tasks resolved in the first chapter (resolvedIn = 0)', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'e1',
        type: 'task-create',
        taskId: 't-early',
        description: '第一章就解决的任务',
        chapterIndex: 0,
        source: 'chapter',
      },
      {
        id: 'e2',
        type: 'task-resolve',
        taskId: 't-early',
        chapterIndex: 0,
        source: 'chapter',
      },
    ])
    expect(getOpenTasks(memory)).not.toContain('t-early')
  })
})
