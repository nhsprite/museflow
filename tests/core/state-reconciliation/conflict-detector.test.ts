import { describe, expect, it } from 'vitest'
import {
  detectItemLocationConflicts,
  detectItemStateConflicts,
  detectCharacterLocationConflicts,
  detectCharacterStatusConflicts,
  detectSecretRevealConflicts,
  detectTimeAnchorConflicts,
  detectAllConflicts,
} from '../../../src/core/state-reconciliation/conflict-detector.js'
import type { StoryState } from '../../../src/types/story-state.js'

function baseState(): StoryState {
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

describe('conflict-detector', () => {
  it('detects item location retcon', () => {
    const state = baseState()
    state.keyItemsLocation = { '血封信笺': '妆台抽屉' }
    const outline = '第10章：血封信笺被转移至刑部证物房。'

    const conflicts = detectItemLocationConflicts(state, outline)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].subject).toBe('血封信笺')
    expect(conflicts[0].oldValue).toBe('妆台抽屉')
    expect(conflicts[0].newValue).toBe('刑部证物房')
    expect(conflicts[0].type).toBe('retcon')
  })

  it('ignores item not mentioned in outline', () => {
    const state = baseState()
    state.keyItemsLocation = { '血封信笺': '妆台抽屉' }
    const outline = '第10章：主角前往刑部查阅卷宗。'

    const conflicts = detectItemLocationConflicts(state, outline)
    expect(conflicts).toHaveLength(0)
  })

  it('detects item state retcon', () => {
    const state = baseState()
    state.keyItemsState = { '血封信笺': '完整' }
    const outline = '第10章：血封信笺已被焚毁。'

    const conflicts = detectItemStateConflicts(state, outline)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].attribute).toBe('状态')
    expect(conflicts[0].newValue).toContain('焚毁')
  })

  it('detects character location retcon', () => {
    const state = baseState()
    state.characterLocations = { '苏半城': '正房' }
    const outline = '第10章：苏半城被押至刑部大牢。'

    const conflicts = detectCharacterLocationConflicts(state, outline)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].oldValue).toBe('正房')
    expect(conflicts[0].newValue).toBe('刑部大牢')
  })

  it('detects character status retcon', () => {
    const state = baseState()
    state.characterStatus = { '苏半城': '自由' }
    const outline = '第10章：苏半城已身受重伤。'

    const conflicts = detectCharacterStatusConflicts(state, outline)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].subject).toBe('苏半城')
    expect(conflicts[0].attribute).toBe('状态')
  })

  it('detects repeated secret reveal as contradiction', () => {
    const state = baseState()
    state.revealedSecrets = ['苏半城才是幕后主使']
    const outline = '第10章：真相大白，苏半城才是幕后主使。'

    const conflicts = detectSecretRevealConflicts(state, outline)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].type).toBe('contradiction')
    expect(conflicts[0].severity).toBe('blocking')
  })

  it('detects explicit time jump', () => {
    const state = baseState()
    state.storyTime = '民国三年三月初五'
    const outline = '第10章：三日后，主角来到天津。'

    const conflicts = detectTimeAnchorConflicts(state, outline, 9)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].type).toBe('time_jump')
  })

  it('detects all conflict types together', () => {
    const state = baseState()
    state.keyItemsLocation = { '血封信笺': '妆台抽屉' }
    state.characterLocations = { '苏半城': '正房' }
    state.revealedSecrets = ['苏半城是主谋']
    state.storyTime = '民国三年三月初五'
    const outline = '三日后，苏半城被押至刑部大牢，血封信笺被转移至刑部证物房。真相大白，苏半城是主谋。'

    const conflicts = detectAllConflicts(state, outline, 9)
    expect(conflicts.length).toBeGreaterThanOrEqual(3)
    expect(conflicts.some(c => c.subject === '血封信笺')).toBe(true)
    expect(conflicts.some(c => c.subject === '苏半城')).toBe(true)
    expect(conflicts.some(c => c.type === 'contradiction')).toBe(true)
  })

  it('ignores memory contexts for location', () => {
    const state = baseState()
    state.characterLocations = { '苏半城': '刑部大牢' }
    const outline = '苏半城回忆起曾经在正房的日子。'

    const conflicts = detectCharacterLocationConflicts(state, outline)
    expect(conflicts).toHaveLength(0)
  })

  it('ignores conditional contexts for state', () => {
    const state = baseState()
    state.keyItemsState = { '血封信笺': '完整' }
    const outline = '如果血封信笺被焚毁，计划就失败了。'

    const conflicts = detectItemStateConflicts(state, outline)
    expect(conflicts).toHaveLength(0)
  })

  it('ignores negated state changes', () => {
    const state = baseState()
    state.keyItemsState = { '血封信笺': '完整' }
    const outline = '血封信笺并没有被焚毁。'

    const conflicts = detectItemStateConflicts(state, outline)
    expect(conflicts).toHaveLength(0)
  })

  it('ignores direct speech containing old location', () => {
    const state = baseState()
    state.characterLocations = { '苏半城': '刑部大牢' }
    const outline = '他大喊："我正房里还有东西！"'

    const conflicts = detectCharacterLocationConflicts(state, outline)
    expect(conflicts).toHaveLength(0)
  })

  it('detects active movement to new location', () => {
    const state = baseState()
    state.characterLocations = { '苏半城': '正房' }
    const outline = '苏半城连夜逃往天津租界。'

    const conflicts = detectCharacterLocationConflicts(state, outline)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].newValue).toBe('天津租界')
  })

  it('detects static location as retcon', () => {
    const state = baseState()
    state.keyItemsLocation = { '血封信笺': '妆台抽屉' }
    const outline = '血封信笺静静地躺在刑部证物房里。'

    const conflicts = detectItemLocationConflicts(state, outline)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].newValue).toBe('刑部证物房')
  })
})
