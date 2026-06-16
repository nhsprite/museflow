import { describe, expect, it } from 'vitest'
import { resolveOutlineStrategy } from '../../src/utils/outline-strategy.js'
import type { Story } from '../../src/types/story.js'
import type { ChapterOutline } from '../../src/graph/state.js'

function makeStory(outlineStrategy?: 'layered' | 'legacy'): Story {
  return {
    id: 'story-1',
    title: 'Story',
    idea: 'idea',
    genre: 'default',
    totalChapters: 3,
    status: 'writing',
    provider: 'openai',
    outputDir: '/tmp/story',
    createdAt: 0,
    updatedAt: 0,
    outlineStrategy,
  }
}

function makeOutline(descriptions: string[]): ChapterOutline[] {
  return descriptions.map((description, idx) => ({
    number: idx + 1,
    title: `Chapter ${idx + 1}`,
    description,
  }))
}

describe('resolveOutlineStrategy', () => {
  it('returns explicit layered when set', () => {
    const story = makeStory('layered')
    const outline = makeOutline(['a'.repeat(100)])
    expect(resolveOutlineStrategy(story, outline)).toBe('layered')
  })

  it('returns legacy for old detailed outlines', () => {
    const story = makeStory()
    const outline = makeOutline(['a'.repeat(80), 'b'.repeat(90)])
    expect(resolveOutlineStrategy(story, outline)).toBe('legacy')
  })

  it('defaults to legacy when no strategy and short outlines', () => {
    const story = makeStory()
    const outline = makeOutline(['a'.repeat(30)])
    expect(resolveOutlineStrategy(story, outline)).toBe('legacy')
  })
})
