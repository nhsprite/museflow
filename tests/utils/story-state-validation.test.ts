import { describe, expect, it } from 'vitest'
import { sanitizeStoryState, formatStateConflicts } from '../../src/utils/story-state-validation.js'
import type { StoryState } from '../../src/types/story-state.js'
import type { Character } from '../../src/types/character.js'

describe('sanitizeStoryState', () => {
  const characters: Character[] = [
    { id: '1', storyId: 's', name: '苏半城', description: '', createdAt: 1 },
    { id: '2', storyId: 's', name: '何氏（奶娘）', description: '', createdAt: 2 },
  ]

  it('removes invented characters from locations/status', () => {
    const state: StoryState = {
      characterLocations: { 苏半城: '正房', 苏孟祥: '门外', 陆廷樑: '灵堂' },
      characterStatus: { 苏半城: '冷静', 苏孟祥: '疲惫' },
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.state.characterLocations).toEqual({ 苏半城: '正房' })
    expect(report.state.characterStatus).toEqual({ 苏半城: '冷静' })
    expect(report.removedCharacters).toContain('苏孟祥')
    expect(report.removedCharacters).toContain('陆廷樑')
  })

  it('keeps established characters when preserveExisting is true', () => {
    const existingStoryState: StoryState = {
      characterLocations: { 苏半城: '正房', 亲王: '王府' },
      characterStatus: { 苏半城: '冷静', 亲王: '阴沉' },
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    }
    const state: StoryState = {
      ...existingStoryState,
      characterLocations: { ...existingStoryState.characterLocations, 苏孟祥: '门外' },
      characterStatus: { ...existingStoryState.characterStatus, 苏孟祥: '疲惫' },
    }
    const report = sanitizeStoryState(state, characters, { preserveExisting: true, existingStoryState })
    expect(report.state.characterLocations).toEqual({ 苏半城: '正房', 亲王: '王府' })
    expect(report.state.characterStatus).toEqual({ 苏半城: '冷静', 亲王: '阴沉' })
    expect(report.removedCharacters).toContain('苏孟祥')
  })

  it('detects conflicting item locations', () => {
    const state: StoryState = {
      characterLocations: {},
      characterStatus: {},
      keyItemsLocation: {
        '廷樾手记': '妆台抽屉',
        '《廷樾手记》': '樟木箱暗格',
      },
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.itemLocationConflicts.length).toBeGreaterThan(0)
  })

  it('resolves conflicting item locations by keeping the latest entry', () => {
    const state: StoryState = {
      characterLocations: {},
      characterStatus: {},
      keyItemsLocation: {
        '血封信笺（柏字残画）': '妆台抽屉附近',
        '血封信笺（密函）': '东院正房妆台暗屉',
      },
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    }
    const report = sanitizeStoryState(state, characters, { chapterIndex: 5 })
    // 只保留一个规范名条目
    expect(Object.keys(report.state.keyItemsLocation).length).toBe(1)
    expect(Object.values(report.state.keyItemsLocation)[0]).toBe('东院正房妆台暗屉')
    // 旧位置归档到 supersededFacts
    expect(report.state.supersededFacts?.length).toBe(1)
    expect(report.state.supersededFacts?.[0].subject).toBe('血封信笺')
    expect(report.state.supersededFacts?.[0].oldFact).toBe('妆台抽屉附近')
    // 权威位置写入 canonicalFacts
    expect(report.state.canonicalFacts?.length).toBe(1)
    expect(report.state.canonicalFacts?.[0].subject).toBe('血封信笺')
    expect(report.state.canonicalFacts?.[0].value).toBe('东院正房妆台暗屉')
    expect(report.state.canonicalFacts?.[0].supersedes?.length).toBe(1)
  })

  it('keeps the latest entry as authoritative when locations conflict', () => {
    const state: StoryState = {
      characterLocations: {},
      characterStatus: {},
      keyItemsLocation: {
        '冻石朱泥小印（旧印）': '妆奁中',
        '冻石朱泥小印（陆家旧印）': '东院正房妆台抽屉最上一格',
      },
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    }
    const report = sanitizeStoryState(state, characters, { chapterIndex: 3 })
    expect(Object.values(report.state.keyItemsLocation)[0]).toBe('东院正房妆台抽屉最上一格')
    expect(report.state.supersededFacts?.[0].oldFact).toBe('妆奁中')
  })

  it('removes facts that reference invented characters', () => {
    const state: StoryState = {
      characterLocations: {},
      characterStatus: {},
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: ['苏孟祥出门办事'],
      revealedSecrets: ['陆廷樑偷了东西'],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.state.activePlots).toEqual([])
    expect(report.state.revealedSecrets).toEqual([])
    expect(report.removedFacts).toContain('苏孟祥出门办事')
    expect(report.removedFacts).toContain('陆廷樑偷了东西')
  })

  it('detects ambiguous item names at same location', () => {
    const state: StoryState = {
      characterLocations: {},
      characterStatus: {},
      keyItemsLocation: {
        '廷樾手记': '妆台抽屉',
        '《廷樾手记》': '妆台抽屉',
      },
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    }
    const report = sanitizeStoryState(state, characters)
    expect(report.ambiguousItems.length).toBeGreaterThan(0)
    expect(report.ambiguousItems[0].items).toContain('廷樾手记')
  })

  it('formats state conflicts into instructions', () => {
    const state: StoryState = {
      characterLocations: {},
      characterStatus: {},
      keyItemsLocation: {
        '廷樾手记': '妆台抽屉',
        '《廷樾手记》': '樟木箱暗格',
      },
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    }
    const report = sanitizeStoryState(state, characters)
    const formatted = formatStateConflicts(report)
    expect(formatted).toContain('物品位置冲突')
    expect(formatted).toContain('妆台抽屉')
    expect(formatted).toContain('樟木箱暗格')
  })
})
