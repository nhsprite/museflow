import { describe, expect, it } from 'vitest'
import {
  buildForeshadowDeadlineBoundaryCorrectionEvents,
  clampForeshadowDeadlineToBoundary,
  resolveStoryBoundaryChapter,
} from '../../src/story-memory/foreshadow-deadline-boundary.js'
import { applyEvents, createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import type { StoryEvent } from '../../src/types/story-memory.js'

function introduce(id: string): StoryEvent {
  return {
    id: `evt-introduce-${id}`,
    type: 'foreshadow-introduce',
    foreshadowId: id,
    text: id,
    kind: 'other',
    resolutionPolicy: 'must_resolve',
    required: true,
    beatId: null,
    expectedFulfillChapter: 4,
    chapterIndex: 2,
    source: 'outline',
  }
}

function extend(id: string): StoryEvent {
  return {
    id: `evt-extend-${id}`,
    type: 'foreshadow-deadline-extend',
    foreshadowId: id,
    newExpectedFulfillChapter: 70,
    chapterIndex: 57,
    source: 'outline',
  }
}

describe('foreshadow deadline boundary', () => {
  it('uses the largest persisted story boundary so legitimate act extensions are preserved', () => {
    expect(
      resolveStoryBoundaryChapter({
        runtimeTotalChapters: 61,
        storyTotalChapters: 61,
        storyArc: {
          totalChapters: 66,
          acts: [
            {
              index: 1,
              startChapter: 1,
              endChapter: 67,
              title: '延长幕',
              theme: '收束',
              function: '完成故事',
              mandatoryBeats: [],
            },
          ],
          keyBeats: [],
        },
      })
    ).toBe(67)
  })

  it('caps a proposed extension at the resolved boundary', () => {
    expect(clampForeshadowDeadlineToBoundary(66, 61)).toBe(61)
    expect(clampForeshadowDeadlineToBoundary(60, 61)).toBe(60)
  })

  it('corrects only active must-resolve foreshadows and is idempotent after replay', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      introduce('fs-active'),
      extend('fs-active'),
      introduce('fs-fulfilled'),
      extend('fs-fulfilled'),
      {
        id: 'evt-fulfill-fs-fulfilled',
        type: 'foreshadow-fulfill',
        foreshadowId: 'fs-fulfilled',
        chapterIndex: 58,
        source: 'chapter',
      },
      introduce('fs-waived'),
      extend('fs-waived'),
      {
        id: 'evt-waive-fs-waived',
        type: 'foreshadow-waive',
        foreshadowId: 'fs-waived',
        chapterIndex: 58,
        source: 'outline',
      },
    ])

    const corrections = buildForeshadowDeadlineBoundaryCorrectionEvents(memory, 61, 58)

    expect(corrections).toHaveLength(1)
    expect(corrections[0]).toMatchObject({
      type: 'foreshadow-policy-set',
      foreshadowId: 'fs-active',
      resolutionPolicy: 'must_resolve',
      expectedFulfillChapter: 61,
      chapterIndex: 58,
    })

    const corrected = applyEvents(memory, corrections)
    expect(corrected.foreshadows['fs-active']?.expectedFulfillChapter).toBe(61)
    expect(buildForeshadowDeadlineBoundaryCorrectionEvents(corrected, 61, 58)).toEqual([])
  })
})
