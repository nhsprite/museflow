import { describe, expect, it } from 'vitest'
import { sanitizeStoryState } from '../../src/utils/story-state-validation.js'
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
})
