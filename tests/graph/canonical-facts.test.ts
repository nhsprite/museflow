import { describe, expect, it } from 'vitest'
import {
  mergeStoryState,
  filterSupersededFactsFromTimeline,
  filterSupersededEventsFromTimeline,
} from '../../src/graph/utils/reconciler.js'
import type { StoryState } from '../../src/types/story-state.js'

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
  it('merges new canonical facts', () => {
    const existing = emptyState()
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'cf1', subject: '木之灵物', attribute: '所在位置', value: '昆仑山', establishedIn: 2 },
      ],
    }

    const merged = mergeStoryState(existing, delta)
    expect(merged.canonicalFacts).toHaveLength(1)
    expect(merged.canonicalFacts?.[0].value).toBe('昆仑山')
  })

  it('deduplicates canonical facts with same subject/attribute/value', () => {
    const existing: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'cf1', subject: '木之灵物', attribute: '所在位置', value: '昆仑山', establishedIn: 2 },
      ],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'cf2', subject: '木之灵物', attribute: '所在位置', value: '昆仑山', establishedIn: 3 },
      ],
    }

    const merged = mergeStoryState(existing, delta)
    expect(merged.canonicalFacts).toHaveLength(1)
  })

  it('keeps canonical facts with different attributes', () => {
    const existing: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'cf1', subject: '木之灵物', attribute: '所在位置', value: '昆仑山', establishedIn: 2 },
      ],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'cf2', subject: '木之灵物', attribute: '状态', value: '激活', establishedIn: 3 },
      ],
    }

    const merged = mergeStoryState(existing, delta)
    expect(merged.canonicalFacts).toHaveLength(2)
  })

  it('keeps canonical facts from base when delta has none', () => {
    const existing: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'cf1', subject: '木之灵物', attribute: '所在位置', value: '昆仑山', establishedIn: 2 },
      ],
    }
    const delta = emptyState()

    const merged = mergeStoryState(existing, delta)
    expect(merged.canonicalFacts).toHaveLength(1)
  })

  it('normalizes item aliases with same value to the most descriptive key', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsLocation: { '血封信笺': '妆台抽屉' },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsLocation: { '血封信笺（柏字残画）': '妆台抽屉' },
    }

    const merged = mergeStoryState(existing, delta)
    expect(Object.keys(merged.keyItemsLocation)).toEqual(['血封信笺（柏字残画）'])
    expect(merged.keyItemsLocation['血封信笺（柏字残画）']).toBe('妆台抽屉')
  })

  it('overrides old alias when canonical item location changes', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsLocation: { '血封信笺': '妆台抽屉' },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsLocation: { '血封信笺（柏字残画）': '火盆灰烬' },
    }

    const merged = mergeStoryState(existing, delta)
    expect(merged.keyItemsLocation['血封信笺（柏字残画）']).toBe('火盆灰烬')
    expect(merged.keyItemsLocation['血封信笺']).toBeUndefined()
  })

  it('normalizes item state aliases by stripping parenthetical descriptions', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsState: { '血封信笺': '完整' },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsState: { '血封信笺（柏字残画）': '焚毁' },
    }

    const merged = mergeStoryState(existing, delta)
    expect(Object.keys(merged.keyItemsState)).toEqual(['血封信笺（柏字残画）'])
    expect(merged.keyItemsState['血封信笺（柏字残画）']).toBe('焚毁')
  })

  it('clears all canonical aliases when item location changes, avoiding lingering conflicts', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '血封信笺（柏字残画）': '苏半城妆台抽屉附近',
        '血封信笺': '东院正房妆台暗屉最里层薄油纸内',
      },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsLocation: { '血封信笺': '藏经阁夹壁中' },
    }

    const merged = mergeStoryState(existing, delta)
    expect(Object.keys(merged.keyItemsLocation)).toEqual(['血封信笺'])
    expect(merged.keyItemsLocation['血封信笺']).toBe('藏经阁夹壁中')
  })

  it('clears conflicting base entries when delta uses a canonical alias', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '血封信笺（柏字残画）': '苏半城妆台抽屉附近',
        '血封信笺': '东院正房妆台暗屉最里层薄油纸内',
      },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsLocation: { '血封信笺': '藏经阁夹壁中' },
    }

    const merged = mergeStoryState(existing, delta)
    expect(Object.keys(merged.keyItemsLocation)).toEqual(['血封信笺'])
    expect(merged.keyItemsLocation['血封信笺']).toBe('藏经阁夹壁中')
  })
})

describe('filterSupersededFactsFromTimeline', () => {
  it('removes facts that match superseded old values', () => {
    const entries = [
      { character: '旁白', facts: ['木之灵物位于东方灵河旧址'] },
      { character: '主角', facts: ['主角决定前往昆仑山'] },
    ]
    const canonicalFacts = [
      {
        id: 'cf1',
        subject: '木之灵物',
        attribute: '所在位置',
        value: '昆仑山',
        establishedIn: 2,
        supersedes: [{ chapter: 0, oldValue: '东方灵河旧址' }],
      },
    ]

    const filtered = filterSupersededFactsFromTimeline(entries, canonicalFacts)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].character).toBe('主角')
  })

  it('keeps all facts when no canonical facts exist', () => {
    const entries = [{ character: '旁白', facts: ['木之灵物位于东方灵河旧址'] }]
    const filtered = filterSupersededFactsFromTimeline(entries, [])
    expect(filtered).toHaveLength(1)
  })

  it('keeps facts that do not match any superseded value', () => {
    const entries = [{ character: '旁白', facts: ['木之灵物位于东方灵河旧址'] }]
    const canonicalFacts = [
      {
        id: 'cf1',
        subject: '样本',
        attribute: '位置',
        value: '实验室B',
        establishedIn: 2,
        supersedes: [{ chapter: 0, oldValue: '实验室A' }],
      },
    ]

    const filtered = filterSupersededFactsFromTimeline(entries, canonicalFacts)
    expect(filtered).toHaveLength(1)
  })
})

describe('filterSupersededEventsFromTimeline', () => {
  it('removes key events that match superseded old values', () => {
    const events = ['木之灵物在东方灵河旧址被发现', '主角启程前往昆仑山']
    const canonicalFacts = [
      {
        id: 'cf1',
        subject: '木之灵物',
        attribute: '所在位置',
        value: '昆仑山',
        establishedIn: 2,
        supersedes: [{ chapter: 0, oldValue: '东方灵河旧址' }],
      },
    ]

    const filtered = filterSupersededEventsFromTimeline(events, canonicalFacts)
    expect(filtered).toHaveLength(1)
    expect(filtered[0]).toContain('昆仑山')
  })
})
