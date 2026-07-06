import { describe, expect, it } from 'vitest'
import {
  mergeStoryState,
  filterSupersededFactsFromTimeline,
  filterSupersededEventsFromTimeline,
  buildCanonicalFactTimeline,
  buildCharacterFactTimeline,
  buildKeyEventsTimeline,
} from '../../src/graph/utils/reconciler/index.js'
import type { StoryState } from '../../src/types/story-state.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { ChapterSession } from '../../src/core/chapter-generation/routing/types.js'
import type { Character } from '../../src/types/character.js'

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
        {
          id: 'cf1',
          subject: '木之灵物',
          attribute: 'location',
          value: '昆仑山',
          establishedIn: 2,
        },
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
        {
          id: 'cf1',
          subject: '木之灵物',
          attribute: 'location',
          value: '昆仑山',
          establishedIn: 2,
        },
      ],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'cf2',
          subject: '木之灵物',
          attribute: 'location',
          value: '昆仑山',
          establishedIn: 3,
        },
      ],
    }

    const merged = mergeStoryState(existing, delta)
    expect(merged.canonicalFacts).toHaveLength(1)
  })

  it('keeps canonical facts with different attributes', () => {
    const existing: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'cf1',
          subject: '木之灵物',
          attribute: 'location',
          value: '昆仑山',
          establishedIn: 2,
        },
      ],
    }
    const delta: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        { id: 'cf2', subject: '木之灵物', attribute: 'status', value: '激活', establishedIn: 3 },
      ],
    }

    const merged = mergeStoryState(existing, delta)
    expect(merged.canonicalFacts).toHaveLength(2)
  })

  it('keeps canonical facts from base when delta has none', () => {
    const existing: StoryState = {
      ...emptyState(),
      canonicalFacts: [
        {
          id: 'cf1',
          subject: '木之灵物',
          attribute: 'location',
          value: '昆仑山',
          establishedIn: 2,
        },
      ],
    }
    const delta = emptyState()

    const merged = mergeStoryState(existing, delta)
    expect(merged.canonicalFacts).toHaveLength(1)
  })

  it('keeps parenthetical item qualifiers instead of treating them as aliases', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsLocation: { 血封信笺: '妆台抽屉' },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsLocation: { '血封信笺（柏字残画）': '妆台抽屉' },
    }

    const merged = mergeStoryState(existing, delta)
    expect(Object.keys(merged.keyItemsLocation)).toEqual(['血封信笺（柏字残画）', '血封信笺'])
    expect(merged.keyItemsLocation['血封信笺（柏字残画）']).toBe('妆台抽屉')
    expect(merged.keyItemsLocation['血封信笺']).toBe('妆台抽屉')
  })

  it('does not override unqualified item names from parenthetical qualified names', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsLocation: { 血封信笺: '妆台抽屉' },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsLocation: { '血封信笺（柏字残画）': '火盆灰烬' },
    }

    const merged = mergeStoryState(existing, delta)
    expect(merged.keyItemsLocation['血封信笺（柏字残画）']).toBe('火盆灰烬')
    expect(merged.keyItemsLocation['血封信笺']).toBe('妆台抽屉')
  })

  it('keeps parenthetical item state qualifiers', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsState: { 血封信笺: '完整' },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsState: { '血封信笺（柏字残画）': '焚毁' },
    }

    const merged = mergeStoryState(existing, delta)
    expect(Object.keys(merged.keyItemsState)).toEqual(['血封信笺（柏字残画）', '血封信笺'])
    expect(merged.keyItemsState['血封信笺（柏字残画）']).toBe('焚毁')
    expect(merged.keyItemsState['血封信笺']).toBe('完整')
  })

  it('keeps qualified item entries when unqualified item location changes', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '血封信笺（柏字残画）': '苏半城妆台抽屉附近',
        血封信笺: '东院正房妆台暗屉最里层薄油纸内',
      },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsLocation: { 血封信笺: '藏经阁夹壁中' },
    }

    const merged = mergeStoryState(existing, delta)
    expect(Object.keys(merged.keyItemsLocation)).toEqual(['血封信笺', '血封信笺（柏字残画）'])
    expect(merged.keyItemsLocation['血封信笺']).toBe('藏经阁夹壁中')
    expect(merged.keyItemsLocation['血封信笺（柏字残画）']).toBe('苏半城妆台抽屉附近')
  })

  it('does not clear qualified base entries when delta uses an unqualified item name', () => {
    const existing: StoryState = {
      ...emptyState(),
      keyItemsLocation: {
        '血封信笺（柏字残画）': '苏半城妆台抽屉附近',
        血封信笺: '东院正房妆台暗屉最里层薄油纸内',
      },
    }
    const delta: StoryState = {
      ...emptyState(),
      keyItemsLocation: { 血封信笺: '藏经阁夹壁中' },
    }

    const merged = mergeStoryState(existing, delta)
    expect(Object.keys(merged.keyItemsLocation)).toEqual(['血封信笺', '血封信笺（柏字残画）'])
    expect(merged.keyItemsLocation['血封信笺']).toBe('藏经阁夹壁中')
    expect(merged.keyItemsLocation['血封信笺（柏字残画）']).toBe('苏半城妆台抽屉附近')
  })
})

describe('filterSupersededFactsFromTimeline', () => {
  it('does not remove facts by matching superseded old-value prose', () => {
    const entries = [
      { character: '旁白', facts: ['木之灵物位于东方灵河旧址'] },
      { character: '主角', facts: ['主角决定前往昆仑山'] },
    ]
    const canonicalFacts = [
      {
        id: 'cf1',
        subject: '木之灵物',
        attribute: 'location',
        value: '昆仑山',
        establishedIn: 2,
        supersedes: [{ chapter: 0, oldValue: '东方灵河旧址' }],
      },
    ]

    const filtered = filterSupersededFactsFromTimeline(entries, canonicalFacts)
    expect(filtered).toEqual(entries)
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
        attribute: 'location',
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
  it('does not remove key events by matching superseded old-value prose', () => {
    const events = ['木之灵物在东方灵河旧址被发现', '主角启程前往昆仑山']
    const canonicalFacts = [
      {
        id: 'cf1',
        subject: '木之灵物',
        attribute: 'location',
        value: '昆仑山',
        establishedIn: 2,
        supersedes: [{ chapter: 0, oldValue: '东方灵河旧址' }],
      },
    ]

    const filtered = filterSupersededEventsFromTimeline(events, canonicalFacts)
    expect(filtered).toEqual(events)
  })
})

function buildBaseSession(overrides: Partial<ChapterSession> = {}): ChapterSession {
  return {
    chapterIndex: 0,
    rewriteAttempts: 0,
    errorRewriteAttempts: 0,
    autoFixAttempts: 0,
    previousIssues: [],
    previousRawErrorCount: 0,
    routingDecision: undefined,
    forceStructuralRewrite: false,
    rewriteApproved: false,
    ...overrides,
  }
}

function makeGraphState(overrides: Partial<ReducedGraphState> = {}): ReducedGraphState {
  const characters: Character[] = [
    { id: '1', storyId: 's', name: '主角', description: '', createdAt: 1 },
    { id: '2', storyId: 's', name: '侍女', description: '', createdAt: 2 },
  ]
  return {
    story: {
      id: 's',
      title: '测试',
      idea: '',
      genre: 'default',
      totalChapters: 10,
      status: 'writing',
      provider: 'openai',
      outputDir: 'books/s',
      createdAt: 1,
      updatedAt: 1,
    },
    idea: '',
    genre: 'default',
    totalChapters: 10,
    world: null,
    characters,
    outline: [],
    chapters: [],
    currentChapterIndex: 0,
    foreshadowStack: [],
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: true,
    lastPrintedChapter: -1,
    lastTimelineSnapshot: null,
    chapterPlan: null,
    storyState: emptyState(),
    chapterTimeAnchor: undefined,
    verifiedConstraints: [],
    chapterReport: null,
    session: buildBaseSession(),
    authorDecisions: {},
    ...overrides,
  } as ReducedGraphState
}

describe('buildCanonicalFactTimeline', () => {
  it('builds timeline grouped by chapter from canonical facts', () => {
    const state = makeGraphState({
      storyState: {
        ...emptyState(),
        canonicalFacts: [
          {
            id: 'cf1',
            subject: '木之灵物',
            attribute: 'location',
            value: '东方灵河旧址',
            establishedIn: 0,
          },
          {
            id: 'cf2',
            subject: '木之灵物',
            attribute: 'location',
            value: '昆仑山',
            establishedIn: 2,
            supersedes: [{ chapter: 0, oldValue: '东方灵河旧址' }],
          },
        ],
      },
    })

    const timeline = buildCanonicalFactTimeline(state, 2)
    expect(timeline).toContain('第1章权威事实')
    expect(timeline).toContain('第3章权威事实')
    expect(timeline).toContain('木之灵物')
    expect(timeline).toContain('昆仑山')
    expect(timeline).toContain('覆盖：东方灵河旧址')
  })

  it('returns empty marker when no canonical facts exist', () => {
    const state = makeGraphState()
    expect(buildCanonicalFactTimeline(state, 0)).toBe('（暂无权威事实记录）')
  })
})

describe('buildCharacterFactTimeline', () => {
  it('prefers canonical facts over summaries when available', () => {
    const state = makeGraphState({
      storyState: {
        ...emptyState(),
        canonicalFacts: [
          {
            id: 'cf1',
            subject: '主角',
            attribute: 'known_info',
            value: '主角知道密信在书桌抽屉',
            establishedIn: 0,
          },
          {
            id: 'cf2',
            subject: '侍女',
            attribute: 'attitude',
            value: '侍女对主角产生怀疑',
            establishedIn: 1,
          },
        ],
      },
      chapterSummaries: ['第1章摘要：主角知道密信在木箱暗格'],
    })

    const timeline = buildCharacterFactTimeline(state, 1)
    expect(timeline).toContain('第1章角色事实')
    expect(timeline).toContain('主角')
    expect(timeline).toContain('书桌抽屉')
    expect(timeline).not.toContain('木箱暗格')
  })

  it('returns empty marker when no canonical facts and no summaries exist', () => {
    const state = makeGraphState()
    expect(buildCharacterFactTimeline(state, 0)).toBe('（暂无历史记录）')
  })
})

describe('buildKeyEventsTimeline', () => {
  it('prefers canonical facts with key event attribute', () => {
    const state = makeGraphState({
      storyState: {
        ...emptyState(),
        canonicalFacts: [
          {
            id: 'cf1',
            subject: '密信',
            attribute: 'key_event',
            value: '密信被转移至官府仓库',
            establishedIn: 1,
          },
        ],
      },
      chapterSummaries: ['第2章摘要：密信被转移至东院'],
    })

    const timeline = buildKeyEventsTimeline(state, 1)
    expect(timeline).toContain('第2章关键事件')
    expect(timeline).toContain('官府仓库')
    expect(timeline).not.toContain('东院')
  })
})
