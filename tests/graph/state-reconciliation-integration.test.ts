import { describe, expect, it } from 'vitest'
import { reconcileStoryState } from '../../src/graph/utils/story-state.js'
import type { StoryState } from '../../src/types/story-state.js'

function baseState(): StoryState {
  return {
    characterLocations: { '苏半城': '正房' },
    characterStatus: { '苏半城': '自由' },
    keyItemsLocation: { '血封信笺': '妆台抽屉' },
    keyItemsState: { '血封信笺': '完整' },
    activePlots: [],
    revealedSecrets: ['苏半城是主谋'],
    pendingTasks: [],
    currentScene: '',
    storyTime: '民国三年三月初五',
  }
}

describe('reconcileStoryState integration', () => {
  it('returns a report with reconciled state', () => {
    const state = baseState()
    const outline = '第10章：主角前往天津。'

    const report = reconcileStoryState(state, outline, [], 9)
    expect(report.state).toBeDefined()
    expect(report.conflicts).toBeDefined()
    expect(report.autoResolved).toBeDefined()
    expect(report.requiresAuthorDecision).toBeDefined()
    expect(report.suggestedOverrides).toBeDefined()
  })

  it('auto-resolves item location retcon', () => {
    const state = baseState()
    const outline = '第10章：血封信笺被转移至刑部证物房。'

    const report = reconcileStoryState(state, outline, [], 9)
    expect(report.autoResolved.some(c => c.subject === '血封信笺')).toBe(true)
    expect(report.state.keyItemsLocation['血封信笺']).toBe('刑部证物房')
    expect(report.state.canonicalFacts).toHaveLength(1)
    expect(report.state.canonicalFacts?.[0].value).toBe('刑部证物房')
  })

  it('surfaces contradiction for repeated secret reveal', () => {
    const state = baseState()
    const outline = '第10章：真相大白，苏半城是主谋。'

    const report = reconcileStoryState(state, outline, [], 9)
    expect(report.requiresAuthorDecision.length).toBeGreaterThan(0)
    expect(report.requiresAuthorDecision[0].type).toBe('contradiction')
  })

  it('preserves canonical facts from input state', () => {
    const state = baseState()
    state.canonicalFacts = [
      { id: 'f1', subject: '血封信笺', attribute: '所在位置', value: '妆台抽屉', establishedIn: 8 },
    ]
    const outline = '第10章：血封信笺被转移至刑部证物房。'

    const report = reconcileStoryState(state, outline, [], 9)
    const fact = report.state.canonicalFacts?.find(f => f.subject === '血封信笺')
    expect(fact).toBeDefined()
    expect(fact?.value).toBe('刑部证物房')
    expect(fact?.establishedIn).toBe(10)
    expect(fact?.supersedes?.length).toBeGreaterThan(0)
    expect(fact?.supersedes?.[0].chapter).toBe(8)
  })
})
