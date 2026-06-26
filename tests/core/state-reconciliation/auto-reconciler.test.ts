import { describe, expect, it } from 'vitest'
import { autoReconcile, applyCanonicalFactsToState } from '../../../src/core/state-reconciliation/auto-reconciler.js'
import type { StoryState, Conflict } from '../../../src/types/story-state.js'

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

function makeConflict(overrides: Partial<Conflict>): Conflict {
  return {
    id: 'test',
    type: 'retcon',
    subject: '血封信笺',
    attribute: '所在位置',
    oldValue: '妆台抽屉',
    newValue: '刑部证物房',
    outlineReference: '',
    severity: 'auto',
    description: '大纲更新位置',
    ...overrides,
  }
}

describe('auto-reconciler', () => {
  it('auto-resolves item location retcon and generates canonical fact', () => {
    const state = baseState()
    state.keyItemsLocation = { '血封信笺': '妆台抽屉' }
    const conflict = makeConflict({
      subject: '血封信笺',
      attribute: '所在位置',
      oldValue: '妆台抽屉',
      newValue: '刑部证物房',
    })

    const result = autoReconcile([conflict], state, 9)
    expect(result.autoResolved).toHaveLength(1)
    expect(result.remaining).toHaveLength(0)
    expect(result.canonicalFacts).toHaveLength(1)
    expect(result.canonicalFacts[0].subject).toBe('血封信笺')
    expect(result.canonicalFacts[0].value).toBe('刑部证物房')
    expect(result.supersededFacts).toHaveLength(1)
    expect(result.supersededFacts[0].oldFact).toContain('妆台抽屉')
  })

  it('keeps contradiction conflicts in remaining', () => {
    const state = baseState()
    const conflict = makeConflict({
      type: 'contradiction',
      severity: 'blocking',
      subject: '已揭示秘密',
      attribute: '重复揭示',
      description: '大纲再次揭示已暴露秘密',
    })

    const result = autoReconcile([conflict], state, 9)
    expect(result.autoResolved).toHaveLength(0)
    expect(result.remaining).toHaveLength(1)
    expect(result.remaining[0].type).toBe('contradiction')
  })

  it('updates state according to canonical facts', () => {
    const state = baseState()
    state.keyItemsLocation = { '血封信笺': '妆台抽屉', '另一物品': '书架' }
    state.canonicalFacts = [
      {
        id: 'f1',
        subject: '血封信笺',
        attribute: '所在位置',
        value: '刑部证物房',
        establishedIn: 9,
      },
    ]

    const result = applyCanonicalFactsToState(state)
    expect(result.keyItemsLocation['血封信笺']).toBe('刑部证物房')
    expect(result.keyItemsLocation['另一物品']).toBe('书架')
  })

  it('preserves unrelated state fields', () => {
    const state = baseState()
    state.storyTime = '民国三年三月初五'
    state.activePlots = ['追查真凶']

    const result = autoReconcile([], state, 9)
    expect(result.state.storyTime).toBe('民国三年三月初五')
    expect(result.state.activePlots).toEqual(['追查真凶'])
  })
})
