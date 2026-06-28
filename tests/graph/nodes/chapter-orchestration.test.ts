import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as contextJudge from '../../../src/utils/context-judge.js'
import * as issueDeduplication from '../../../src/utils/issue-deduplication.js'
import {
  decide_strategy,
  convergence_check,
  route_strategy,
  route_convergence,
} from '../../../src/graph/nodes/chapter-orchestration.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { Issue } from '../../../src/types/agent.js'

vi.mock('../../../src/model/registry.js', () => ({
  createProvider: vi.fn().mockReturnValue({ chat: vi.fn() }),
}))

vi.mock('../../../src/utils/context-judge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof contextJudge>()
  return {
    ...actual,
    batchClassifyIssues: vi.fn(),
    batchGenerateIssueFingerprints: vi.fn(),
  }
})

vi.mock('../../../src/utils/issue-deduplication.js', async (importOriginal) => {
  const actual = await importOriginal<typeof issueDeduplication>()
  return {
    ...actual,
    deduplicateIssuesSemantically: vi.fn(),
    issueFingerprint: vi.fn(),
  }
})

function defaultClassification(): contextJudge.IssueClassification {
  return {
    isStructural: false,
    isCrossChapter: false,
    isTaskConsistency: false,
    isItemLocationConflict: false,
    isInventedCharacter: false,
    isOutlineStateConflict: false,
    isLocal: false,
    isStateCorruption: false,
    isInterpretive: false,
  }
}

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
  beforeEach(() => {
    vi.mocked(contextJudge.batchClassifyIssues).mockReset()
    vi.mocked(contextJudge.batchGenerateIssueFingerprints).mockReset()
    vi.mocked(issueDeduplication.deduplicateIssuesSemantically).mockReset()
    vi.mocked(issueDeduplication.issueFingerprint).mockReset()
  })

  it('escapes rewrite loop when all errors are state corruption issues', async () => {
    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '血封信笺同时出现在两个位置，物品位置冲突' },
      { id: '2', type: 'hallucination', severity: 'error', description: '虚构角色不在官方角色列表中' },
    ]
    vi.mocked(contextJudge.batchClassifyIssues).mockImplementation(async (_provider, issues) =>
      issues.map(() => ({ ...defaultClassification(), isStateCorruption: true }))
    )

    const state = buildBaseState({ rewriteApproved: true, rewriteAttempts: 1, pendingIssues })
    const result = await decide_strategy(state)

    expect(result.routingDecision).toBe('request_rewrite')
    expect(result.pendingIssues).toEqual(pendingIssues)
  })

  it('does not escape when there are normal errors alongside state corruption', async () => {
    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '血封信笺同时出现在两个位置，物品位置冲突' },
      { id: '2', type: 'consistency', severity: 'error', description: '本章内部时间顺序不一致' },
    ]
    vi.mocked(contextJudge.batchClassifyIssues).mockImplementation(async (_provider, issues) =>
      issues.map((issue) =>
        issue.description.includes('位置冲突')
          ? { ...defaultClassification(), isStateCorruption: true }
          : { ...defaultClassification(), isStateCorruption: false, isStructural: false, isLocal: true }
      )
    )

    const state = buildBaseState({ rewriteApproved: true, rewriteAttempts: 1, pendingIssues })
    const result = await decide_strategy(state)

    expect(result.routingDecision).not.toBe('request_rewrite')
  })

  it('does not escape on first draft when rewriteApproved is false', async () => {
    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '血封信笺同时出现在两个位置，物品位置冲突' },
    ]
    const state = buildBaseState({ rewriteApproved: false, pendingIssues })

    const result = await decide_strategy(state)

    expect(result.routingDecision).toBe('draft_chapter')
  })
})

describe('route_strategy', () => {
  it('returns request_rewrite when policy decides to stop loop', () => {
    const state = buildBaseState({ routingDecision: 'request_rewrite' })
    expect(route_strategy(state)).toBe('request_rewrite')
  })

  it('returns finalize_chapter as fallback when routingDecision is undefined', () => {
    const state = buildBaseState({ routingDecision: undefined })
    expect(route_strategy(state)).toBe('finalize_chapter')
  })
})

describe('convergence_check', () => {
  beforeEach(() => {
    vi.mocked(contextJudge.batchClassifyIssues).mockReset()
    vi.mocked(contextJudge.batchGenerateIssueFingerprints).mockReset()
    vi.mocked(issueDeduplication.deduplicateIssuesSemantically).mockReset()
    vi.mocked(issueDeduplication.issueFingerprint).mockReset()
  })

  it('routes to request_rewrite after max attempts with state corruption majority', async () => {
    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '血封信笺同时出现在两个位置，物品位置冲突' },
      { id: '2', type: 'hallucination', severity: 'error', description: '虚构角色不在官方角色列表中' },
    ]
    vi.mocked(contextJudge.batchClassifyIssues).mockImplementation(async (_provider, issues) =>
      issues.map(() => ({ ...defaultClassification(), isStateCorruption: true }))
    )
    vi.mocked(issueDeduplication.deduplicateIssuesSemantically).mockImplementation(async (_provider, issues) => issues)

    const state = buildBaseState({
      rewriteApproved: true,
      errorRewriteAttempts: 3,
      pendingIssues,
      previousIssues: [],
      previousRawErrorCount: 0,
    })

    const result = await convergence_check(state)

    expect(result.routingDecision).toBe('request_rewrite')
    expect(result.rewriteApproved).toBe(false)
  })

  it('returns to decide_strategy when below max attempts', async () => {
    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '血封信笺同时出现在两个位置，物品位置冲突' },
    ]
    vi.mocked(contextJudge.batchClassifyIssues).mockImplementation(async (_provider, issues) =>
      issues.map(() => ({ ...defaultClassification(), isStateCorruption: true }))
    )
    vi.mocked(issueDeduplication.deduplicateIssuesSemantically).mockImplementation(async (_provider, issues) => issues)

    const state = buildBaseState({
      rewriteApproved: true,
      errorRewriteAttempts: 1,
      pendingIssues,
      previousIssues: [],
      previousRawErrorCount: 0,
    })

    const result = await convergence_check(state)

    expect(result.routingDecision).toBe('decide_strategy')
    expect(result.rewriteApproved).toBe(true)
  })

  it('finalizes when no errors remain', async () => {
    vi.mocked(issueDeduplication.deduplicateIssuesSemantically).mockImplementation(async (_provider, issues) => issues)

    const state = buildBaseState({
      rewriteApproved: true,
      errorRewriteAttempts: 2,
      pendingIssues: [],
      previousIssues: [],
      previousRawErrorCount: 0,
    })

    const result = await convergence_check(state)

    expect(result.routingDecision).toBe('finalize_chapter')
  })
})

describe('route_convergence', () => {
  it('returns request_rewrite when policy decides to stop loop', () => {
    const state = buildBaseState({ routingDecision: 'request_rewrite' })
    expect(route_convergence(state)).toBe('request_rewrite')
  })

  it('returns finalize_chapter as fallback when routingDecision is undefined', () => {
    const state = buildBaseState({ routingDecision: undefined })
    expect(route_convergence(state)).toBe('finalize_chapter')
  })
})
