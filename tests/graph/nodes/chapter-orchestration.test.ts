import { describe, expect, it } from 'vitest'
import { decide_strategy, convergence_check } from '../../../src/graph/nodes/chapter-orchestration.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { Issue } from '../../../src/types/agent.js'

function buildBaseState(overrides: Partial<ReducedGraphState> = {}): ReducedGraphState {
  return {
    story: { id: 'story-1', title: 'Story', outputDir: '/tmp/story' },
    idea: 'idea',
    genre: 'default',
    totalChapters: 3,
    world: null,
    characters: [],
    outline: [
      { number: 1, title: '启程', description: '主角离开家乡。' },
      { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
      { number: 3, title: '脱困', description: '主角脱困。' },
    ],
    chapters: [null, null, null],
    currentChapterIndex: 1,
    foreshadowStack: [],
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: true,
    lastPrintedChapter: 0,
    lastTimelineSnapshot: null,
    chapterPlan: null,
    storyState: {
      characterLocations: {},
      characterStatus: {},
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    },
    autoFixAttempts: 0,
    verifiedConstraints: [],
    rewriteAttempts: 0,
    errorRewriteAttempts: 0,
    previousIssues: [],
    previousRawErrorCount: 0,
    forceStructuralRewrite: false,
    routingDecision: undefined,
    ...overrides,
  }
}

describe('decide_strategy', () => {
  it('escapes rewrite loop when all errors are state corruption issues', async () => {
    const pendingIssues: Issue[] = [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '血封信笺同时出现在两个位置，物品位置冲突',
      },
      {
        id: '2',
        type: 'hallucination',
        severity: 'error',
        description: '虚构角色不在官方角色列表中',
      },
    ]
    const state = buildBaseState({
      rewriteApproved: true,
      rewriteAttempts: 1,
      pendingIssues,
    })

    const result = await decide_strategy(state)

    expect(result.routingDecision).toBe('request_rewrite')
    expect(result.pendingIssues).toEqual(pendingIssues)
  })

  it('does not escape when there are normal errors alongside state corruption', async () => {
    const pendingIssues: Issue[] = [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '血封信笺同时出现在两个位置，物品位置冲突',
      },
      {
        id: '2',
        type: 'consistency',
        severity: 'error',
        description: '本章内部时间顺序不一致',
      },
    ]
    const state = buildBaseState({
      rewriteApproved: true,
      rewriteAttempts: 1,
      pendingIssues,
    })

    const result = await decide_strategy(state)

    expect(result.routingDecision).not.toBe('request_rewrite')
  })

  it('does not escape on first draft when rewriteApproved is false', async () => {
    const pendingIssues: Issue[] = [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '血封信笺同时出现在两个位置，物品位置冲突',
      },
    ]
    const state = buildBaseState({
      rewriteApproved: false,
      pendingIssues,
    })

    const result = await decide_strategy(state)

    expect(result.routingDecision).toBe('draft_chapter')
  })
})

describe('convergence_check', () => {
  it('routes to request_rewrite after max attempts with state corruption majority', () => {
    const pendingIssues: Issue[] = [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '血封信笺同时出现在两个位置，物品位置冲突',
      },
      {
        id: '2',
        type: 'hallucination',
        severity: 'error',
        description: '虚构角色不在官方角色列表中',
      },
    ]
    const state = buildBaseState({
      rewriteApproved: true,
      errorRewriteAttempts: 3,
      pendingIssues,
      previousIssues: [],
      previousRawErrorCount: 0,
    })

    const result = convergence_check(state)

    expect(result.routingDecision).toBe('request_rewrite')
    expect(result.rewriteApproved).toBe(false)
  })

  it('returns to decide_strategy when below max attempts', () => {
    const pendingIssues: Issue[] = [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '血封信笺同时出现在两个位置，物品位置冲突',
      },
    ]
    const state = buildBaseState({
      rewriteApproved: true,
      errorRewriteAttempts: 1,
      pendingIssues,
      previousIssues: [],
      previousRawErrorCount: 0,
    })

    const result = convergence_check(state)

    expect(result.routingDecision).toBe('decide_strategy')
    expect(result.rewriteApproved).toBe(true)
  })

  it('finalizes when no errors remain', () => {
    const state = buildBaseState({
      rewriteApproved: true,
      errorRewriteAttempts: 2,
      pendingIssues: [],
      previousIssues: [],
      previousRawErrorCount: 0,
    })

    const result = convergence_check(state)

    expect(result.routingDecision).toBe('finalize_chapter')
  })
})
