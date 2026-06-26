import { describe, expect, it } from 'vitest'
import {
  createEmptyStoryState,
  isEmptyStoryState,
} from '../../../src/storage/database/dao/story-state.js'

describe('createEmptyStoryState', () => {
  it('initializes canonicalFacts as empty array', () => {
    const state = createEmptyStoryState()
    expect(state.canonicalFacts).toEqual([])
  })
})

describe('isEmptyStoryState', () => {
  it('returns true for null', () => {
    expect(isEmptyStoryState(null)).toBe(true)
  })

  it('returns true for a freshly created empty state', () => {
    expect(isEmptyStoryState(createEmptyStoryState())).toBe(true)
  })

  it('returns false when only canonicalFacts is present', () => {
    const state = createEmptyStoryState()
    state.canonicalFacts = [
      { id: 'cf1', subject: '木之灵物', attribute: '所在位置', value: '昆仑山', establishedIn: 2 },
    ]
    expect(isEmptyStoryState(state)).toBe(false)
  })

  it('returns false when only supersededFacts is present', () => {
    const state = createEmptyStoryState()
    state.supersededFacts = [
      { subject: '木之灵物', oldFact: '在东方灵河旧址', reason: '后续大纲更新', chapterIndex: 0 },
    ]
    expect(isEmptyStoryState(state)).toBe(false)
  })

  it('returns false when only characterLocations is present', () => {
    const state = createEmptyStoryState()
    state.characterLocations = { 黛玉: '昆仑山' }
    expect(isEmptyStoryState(state)).toBe(false)
  })
})
