import { describe, it, expect } from 'vitest'
import { parseStoryEventsBlock } from '../../src/story-memory/parser.js'

describe('parseStoryEventsBlock', () => {
  it('parses character-location events', () => {
    const text = `=== STORY_EVENTS ===
- character-location: c-1 -> l-1
- foreshadow-fulfill: f-1
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 2)
    expect(events).toHaveLength(2)
    expect(events[0]?.type).toBe('character-location')
    expect(events[1]?.type).toBe('foreshadow-fulfill')
  })

  it('returns empty array when block is missing', () => {
    const events = parseStoryEventsBlock('正文', 1)
    expect(events).toHaveLength(0)
  })

  it('parses item-location events', () => {
    const text = `=== STORY_EVENTS ===
- item-location: i-1 -> c-1
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('item-location')
  })

  it('parses explicit item holder and location fields', () => {
    const text = `=== STORY_EVENTS ===
- item-location: item-1 / holder=none / location=loc-1 @p3
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 0)

    expect(events[0]).toMatchObject({
      type: 'item-location',
      itemId: 'item-1',
      holderId: null,
      locationId: 'loc-1',
      evidence: { paragraphIndex: 3 },
    })
  })

  it('rejects free-form prose in legacy item-location targets', () => {
    const text = `=== STORY_EVENTS ===
- item-location: item-1 -> 登记台右格原位 @p1
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 0)

    expect(events).toEqual([])
  })

  it('parses plot-advance events', () => {
    const text = `=== STORY_EVENTS ===
- plot-advance: p-1 / a1-b1
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('plot-advance')
  })

  it('parses paragraph evidence markers on story events', () => {
    const text = `=== STORY_EVENTS ===
- plot-advance: p-1 / a1-b1 @p2
=== CHAPTER_CONTENT ===
第一段。

第二段。`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]?.evidence).toEqual({ paragraphIndex: 2 })
  })

  it('parses character-status events', () => {
    const text = `=== STORY_EVENTS ===
- character-status: c-1 / health -> injured
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('character-status')
  })

  it('parses item-state events', () => {
    const text = `=== STORY_EVENTS ===
- item-state: i-1 / condition -> broken
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('item-state')
  })

  it('parses foreshadow-introduce events', () => {
    const text = `=== STORY_EVENTS ===
- foreshadow-introduce: f-1 / 5
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('foreshadow-introduce')
  })

  it('parses rich foreshadow-introduce metadata', () => {
    const text = `=== STORY_EVENTS ===
- foreshadow-introduce: f-1 / expected=5 / kind=character_arc / required=false / beat=A1-M2 / text=角色A在场景A中的迟疑暗示后续选择 @p1
=== CHAPTER_CONTENT ===
角色A在场景A中短暂停顿。`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'foreshadow-introduce',
      foreshadowId: 'f-1',
      expectedFulfillChapter: 5,
      kind: 'character_arc',
      required: false,
      beatId: 'A1-M2',
      text: '角色A在场景A中的迟疑暗示后续选择',
      evidence: { paragraphIndex: 1 },
    })
  })

  it('parses task-create and task-resolve events', () => {
    const text = `=== STORY_EVENTS ===
- task-create: t-1 / find the key
- task-resolve: t-1
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(2)
    expect(events[0]?.type).toBe('task-create')
    expect(events[1]?.type).toBe('task-resolve')
  })

  it('ignores unrecognized lines inside the block', () => {
    const text = `=== STORY_EVENTS ===
- character-location: c-1 -> l-1
- unknown-event: something
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
  })
})
