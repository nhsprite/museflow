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

  it('parses plot-advance events', () => {
    const text = `=== STORY_EVENTS ===
- plot-advance: p-1 / a1-b1
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('plot-advance')
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
