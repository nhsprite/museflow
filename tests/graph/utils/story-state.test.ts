import { describe, expect, it } from 'vitest'
import { mergeStoryState } from '../../../src/graph/utils/story-state.js'
import type { StoryState } from '../../../src/types/story-state.js'

function emptyState(): StoryState {
  return {
    characterLocations: {},
    characterStatus: {},
    keyItemsLocation: {},
    keyItemsState: {},
    activePlots: [],
    revealedSecrets: [],
    pendingTasks: [],
    currentScene: '',
    storyTime: '',
  }
}

describe('mergeStoryState', () => {
  it('deduplicates existing base items when delta does not mention them', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '血封信笺（柏字残画）': '妆台抽屉附近',
        '血封信笺（密函）': '东院正房妆台暗屉',
      },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsLocation: {},
    }
    const merged = mergeStoryState(existing, delta)
    expect(Object.keys(merged.keyItemsLocation).length).toBe(1)
    expect(Object.values(merged.keyItemsLocation)[0]).toBe('东院正房妆台暗屉')
  })

  it('overrides old canonical entries with delta entries', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '血封信笺（柏字残画）': '妆台抽屉附近',
        '血封信笺（密函）': '东院正房妆台暗屉',
      },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '血封信笺': '袖袋中',
      },
    }
    const merged = mergeStoryState(existing, delta)
    expect(Object.keys(merged.keyItemsLocation).length).toBe(1)
    expect(merged.keyItemsLocation['血封信笺']).toBe('袖袋中')
  })

  it('merges supersededFacts and canonicalFacts without duplicates', () => {
    const existing: StoryState = {
      ...emptyState(),
      supersededFacts: [{ subject: '血封信笺', oldFact: '妆台抽屉附近', reason: '冲突', chapterIndex: 1 }],
      canonicalFacts: [{ id: 'cf1', subject: '血封信笺', attribute: 'location', value: '东院正房妆台暗屉', establishedIn: 1 }],
    }
    const delta: StoryState = {
      ...emptyState(),
      supersededFacts: [{ subject: '血封信笺', oldFact: '妆台抽屉附近', reason: '冲突', chapterIndex: 1 }],
      canonicalFacts: [{ id: 'cf1', subject: '血封信笺', attribute: 'location', value: '东院正房妆台暗屉', establishedIn: 1 }],
    }
    const merged = mergeStoryState(existing, delta)
    expect(merged.supersededFacts?.length).toBe(1)
    expect(merged.canonicalFacts?.length).toBe(1)
  })

  it('keeps distinct canonical facts for different subjects', () => {
    const existing: StoryState = {
      ...emptyState(),
      canonicalFacts: [{ id: 'cf1', subject: '血封信笺', attribute: 'location', value: '东院正房妆台暗屉', establishedIn: 1 }],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [{ id: 'cf2', subject: '小银刀', attribute: 'location', value: '袖袋', establishedIn: 2 }],
    }
    const merged = mergeStoryState(existing, delta)
    expect(merged.canonicalFacts?.length).toBe(2)
  })
})
