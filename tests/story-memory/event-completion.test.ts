import { describe, expect, it } from 'vitest'
import {
  completeMissingExpectedEvents,
  augmentExpectedEventsWithClaimedBeats,
} from '../../src/story-memory/event-completion.js'
import type { StoryEvent } from '../../src/types/story-memory.js'
import type { ChapterPlan } from '../../src/agents/types.js'
import type { StoryArc } from '../../src/types/outline.js'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'

describe('completeMissingExpectedEvents', () => {
  const content = `=== PRE_WRITE_CHECK ===
check

=== STORY_EVENTS ===
- character-location: c-1 -> loc-2 @p1

=== CHAPTER_CONTENT ===

# 第1章 标题

第一段。

第二段。

第三段。

=== STORY_FINAL_STATE ===
[]`

  it('returns unchanged when no events are missing', () => {
    const expected: StoryEvent[] = [
      {
        id: 'evt-1',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'loc-2',
        chapterIndex: 0,
        source: 'chapter',
      },
    ]
    const actual: StoryEvent[] = [
      {
        id: 'evt-actual',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'loc-2',
        chapterIndex: 0,
        source: 'chapter',
        evidence: { paragraphIndex: 1 },
      },
    ]
    const result = completeMissingExpectedEvents(content, expected, actual, 0)
    expect(result.completedCount).toBe(0)
    expect(result.events).toEqual(actual)
    expect(result.content).toBe(content)
  })

  it('completes missing events with valid paragraph evidence', () => {
    const expected: StoryEvent[] = [
      {
        id: 'evt-1',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'loc-2',
        chapterIndex: 0,
        source: 'chapter',
      },
      {
        id: 'evt-2',
        type: 'item-location',
        itemId: 'item-1',
        holderId: null,
        locationId: 'loc-2',
        chapterIndex: 0,
        source: 'chapter',
      },
      {
        id: 'evt-3',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-1',
        expectedFulfillChapter: 5,
        kind: 'plot',
        required: true,
        chapterIndex: 0,
        source: 'chapter',
      },
    ]
    const actual: StoryEvent[] = [
      {
        id: 'evt-actual',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'loc-2',
        chapterIndex: 0,
        source: 'chapter',
        evidence: { paragraphIndex: 1 },
      },
    ]
    const result = completeMissingExpectedEvents(content, expected, actual, 0)
    expect(result.completedCount).toBe(2)
    expect(result.events).toHaveLength(3)

    const completedItem = result.events.find((e) => e.type === 'item-location')
    expect(completedItem).toBeDefined()
    expect(completedItem!.evidence).toEqual({ paragraphIndex: 1 })

    const completedFs = result.events.find((e) => e.type === 'foreshadow-introduce')
    expect(completedFs).toBeDefined()
    expect(completedFs!.evidence).toEqual({ paragraphIndex: 2 })
  })

  it('injects completed events into the STORY_EVENTS block', () => {
    const expected: StoryEvent[] = [
      {
        id: 'evt-1',
        type: 'item-location',
        itemId: 'item-1',
        holderId: null,
        locationId: 'loc-2',
        chapterIndex: 0,
        source: 'chapter',
      },
    ]
    const actual: StoryEvent[] = []
    const result = completeMissingExpectedEvents(content, expected, actual, 0)
    expect(result.completedCount).toBe(1)
    expect(result.content).toContain('- character-location: c-1 -> loc-2 @p1')
    expect(result.content).toContain('- item-location: item-1 / holder=none / location=loc-2 @p1')
  })

  it('creates a STORY_EVENTS block if none exists', () => {
    const contentWithoutBlock = `=== CHAPTER_CONTENT ===\n# 第1章\n\n第一段。`
    const expected: StoryEvent[] = [
      {
        id: 'evt-1',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'loc-1',
        chapterIndex: 0,
        source: 'chapter',
      },
    ]
    const result = completeMissingExpectedEvents(contentWithoutBlock, expected, [], 0)
    expect(result.completedCount).toBe(1)
    expect(result.content).toContain('=== STORY_EVENTS ===')
    expect(result.content).toContain('- character-location: c-1 -> loc-1 @p1')
    expect(result.content).toContain('=== CHAPTER_CONTENT ===')
  })

  it('caps paragraph index at the total paragraph count', () => {
    const shortContent = `=== CHAPTER_CONTENT ===\n\n# 第1章\n\n只有一段。`
    const expected: StoryEvent[] = [
      {
        id: 'evt-1',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'loc-1',
        chapterIndex: 0,
        source: 'chapter',
      },
      {
        id: 'evt-2',
        type: 'character-location',
        characterId: 'c-2',
        locationId: 'loc-2',
        chapterIndex: 0,
        source: 'chapter',
      },
      {
        id: 'evt-3',
        type: 'character-location',
        characterId: 'c-3',
        locationId: 'loc-3',
        chapterIndex: 0,
        source: 'chapter',
      },
    ]
    const result = completeMissingExpectedEvents(shortContent, expected, [], 0)
    expect(result.completedCount).toBe(3)
    const paragraphIndices = result.events.map((e) => e.evidence?.paragraphIndex)
    expect(paragraphIndices).toEqual([1, 2, 2])
  })

  it('does not synthesize outline-only foreshadow-merge events into chapter text', () => {
    const merge: StoryEvent = {
      id: 'evt-merge-1',
      type: 'foreshadow-merge',
      canonicalForeshadowId: 'fs-early',
      duplicateForeshadowId: 'fs-late',
      reason: 'Same unresolved obligation.',
      chapterIndex: 0,
      source: 'outline',
    }

    const result = completeMissingExpectedEvents(content, [merge], [], 0)

    expect(result.completedCount).toBe(0)
    expect(result.events).toEqual([])
    expect(result.content).toBe(content)
  })

  it('removes an outline-only foreshadow-merge supplied as an actual chapter event', () => {
    const merge: StoryEvent = {
      id: 'evt-merge-actual',
      type: 'foreshadow-merge',
      canonicalForeshadowId: 'fs-early',
      duplicateForeshadowId: 'fs-late',
      reason: 'Same unresolved obligation.',
      chapterIndex: 0,
      source: 'outline',
    }

    const result = completeMissingExpectedEvents(content, [], [merge], 0)

    expect(result.completedCount).toBe(0)
    expect(result.events).toEqual([])
    expect(result.content).toBe(content)
  })

  it('preserves ordinary actual chapter events while removing foreshadow-merge', () => {
    const ordinary: StoryEvent = {
      id: 'evt-character-actual',
      type: 'character-location',
      characterId: 'c-1',
      locationId: 'loc-2',
      chapterIndex: 0,
      source: 'chapter',
      evidence: { paragraphIndex: 1 },
    }
    const merge: StoryEvent = {
      id: 'evt-merge-actual',
      type: 'foreshadow-merge',
      canonicalForeshadowId: 'fs-early',
      duplicateForeshadowId: 'fs-late',
      reason: 'Same unresolved obligation.',
      chapterIndex: 0,
      source: 'outline',
    }

    const result = completeMissingExpectedEvents(content, [], [ordinary, merge], 0)

    expect(result.completedCount).toBe(0)
    expect(result.events).toEqual([ordinary])
    expect(result.content).toBe(content)
  })
})

describe('augmentExpectedEventsWithClaimedBeats', () => {
  const storyArc: StoryArc = {
    totalChapters: 10,
    acts: [
      {
        index: 1,
        startChapter: 1,
        endChapter: 5,
        title: '第一幕',
        theme: '主题',
        function: '功能',
        mandatoryBeats: ['主角登场', '冲突爆发'],
      },
      {
        index: 2,
        startChapter: 6,
        endChapter: 10,
        title: '第二幕',
        theme: '主题',
        function: '功能',
        mandatoryBeats: ['真相揭露', '反击开始'],
      },
    ],
    keyBeats: [
      {
        id: 'A2-B1',
        beat: '关键镜像闭合',
        deadlineAct: 2,
        required: true,
      },
    ],
  }

  const basePlan: ChapterPlan = {
    chapterIndex: 5,
    sections: [],
    timeline: [],
    outlineCheck: [],
    expectedEvents: [],
    claimedBeatIds: [],
    fulfilledForeshadowIds: [],
    introducedForeshadowIds: [],
    resolvedTaskIds: [],
    createdTaskIds: [],
    claimedMandatoryBeatIds: ['A2-M1'],
  }

  it('returns existing expectedEvents when no mandatory beats are claimed', () => {
    const plan: ChapterPlan = { ...basePlan, claimedMandatoryBeatIds: [] }
    const result = augmentExpectedEventsWithClaimedBeats(plan, storyArc, 5)
    expect(result).toEqual([])
  })

  it('adds a plot-advance event for each claimed mandatory beat', () => {
    const result = augmentExpectedEventsWithClaimedBeats(basePlan, storyArc, 5)
    const plotAdvances = result.filter((e) => e.type === 'plot-advance')
    expect(plotAdvances).toHaveLength(1)
    expect(plotAdvances[0]).toMatchObject({
      type: 'plot-advance',
      chapterIndex: 5,
      source: 'outline',
      plotId: 'act-2',
      beatId: 'A2-M1',
    })
  })

  it('adds a plot-advance event for each claimed global key beat', () => {
    const plan: ChapterPlan = { ...basePlan, claimedBeatIds: ['A2-B1'] }

    const result = augmentExpectedEventsWithClaimedBeats(plan, storyArc, 5)
    const plotAdvances = result.filter((e) => e.type === 'plot-advance')

    expect(plotAdvances).toHaveLength(2)
    expect(plotAdvances).toContainEqual(
      expect.objectContaining({
        type: 'plot-advance',
        chapterIndex: 5,
        source: 'outline',
        plotId: 'plot-main',
        beatId: 'A2-B1',
      })
    )
  })

  it('does not add a plot-advance event for an already proven global key beat', () => {
    const plan: ChapterPlan = {
      ...basePlan,
      claimedMandatoryBeatIds: [],
      claimedBeatIds: ['A2-B1'],
    }
    const memory = createEmptyStoryMemory()
    memory.beats['A2-B1'] = {
      id: 'A2-B1',
      description: '关键镜像闭合',
      actIndex: 2,
      deadlineAct: 2,
      required: true,
      claimedIn: 3,
      provenByEventIds: ['evt-prior-proof'],
    }

    const result = augmentExpectedEventsWithClaimedBeats(plan, storyArc, 5, memory)

    expect(result).toEqual([])
  })

  it('does not duplicate an existing plot-advance event for the same beat', () => {
    const plan: ChapterPlan = {
      ...basePlan,
      expectedEvents: [
        {
          id: 'evt-existing',
          type: 'plot-advance',
          chapterIndex: 5,
          source: 'outline',
          plotId: 'act-2',
          beatId: 'A2-M1',
        },
      ],
    }
    const result = augmentExpectedEventsWithClaimedBeats(plan, storyArc, 5)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ beatId: 'A2-M1' })
  })

  it('skips beat ids that do not belong to the current act', () => {
    const plan: ChapterPlan = { ...basePlan, claimedMandatoryBeatIds: ['A1-M1'] }
    const result = augmentExpectedEventsWithClaimedBeats(plan, storyArc, 5)
    expect(result).toHaveLength(0)
  })

  it('skips unknown or malformed beat ids', () => {
    const plan: ChapterPlan = { ...basePlan, claimedMandatoryBeatIds: ['unknown'] }
    const result = augmentExpectedEventsWithClaimedBeats(plan, storyArc, 5)
    expect(result).toHaveLength(0)
  })
})
