import { describe, expect, it } from 'vitest'
import { completeMissingExpectedEvents } from '../../src/story-memory/event-completion.js'
import type { StoryEvent } from '../../src/types/story-memory.js'

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
})
