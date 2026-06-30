import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  converge_and_decide,
  route_by_decision,
  route_after_validation,
} from '../../../src/graph/nodes/chapter-orchestration.js'
import { readChapterContent } from '../../../src/storage/filesystem/writer.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { Issue } from '../../../src/types/agent.js'

vi.mock('../../../src/storage/filesystem/writer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/filesystem/writer.js')>()
  return {
    ...actual,
    readChapterContent: vi.fn().mockResolvedValue('existing chapter content'),
    writeChapterContent: vi.fn().mockResolvedValue(undefined),
    deleteChapterContent: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../../../src/core/chapter-generation/issue-classifier.js', () => ({
  isStructuralIssue: vi.fn().mockResolvedValue(false),
  isLocalIssue: vi.fn().mockResolvedValue(false),
  isTaskConsistencyIssue: vi.fn().mockResolvedValue(false),
  isStateCorruptionIssue: vi.fn().mockResolvedValue(false),
  isInterpretiveIssue: vi.fn().mockResolvedValue(false),
}))

vi.mock('../../../src/utils/issue-deduplication.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/issue-deduplication.js')>()
  return {
    ...actual,
    deduplicateIssuesSemantically: vi.fn().mockImplementation(async (_provider: unknown, issues: unknown[]) => issues),
    issueFingerprint: vi.fn().mockResolvedValue('fingerprint'),
  }
})

vi.mock('../../../src/model/registry.js', () => ({
  createProvider: vi.fn().mockReturnValue({ chat: vi.fn() }),
}))

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
    chapterPlan: { scenes: [] as never[], summary: 'plan' },
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
    authorDecisions: {},
    ...overrides,
  }
}

describe('converge_and_decide', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(readChapterContent).mockResolvedValue('existing chapter content')
    const {
      isStructuralIssue,
      isLocalIssue,
      isTaskConsistencyIssue,
      isStateCorruptionIssue,
      isInterpretiveIssue,
    } = await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isStructuralIssue).mockResolvedValue(false)
    vi.mocked(isLocalIssue).mockResolvedValue(false)
    vi.mocked(isTaskConsistencyIssue).mockResolvedValue(false)
    vi.mocked(isStateCorruptionIssue).mockResolvedValue(false)
    vi.mocked(isInterpretiveIssue).mockResolvedValue(false)
  })

  it('finalizes when there are no errors and a chapter file already exists', async () => {
    const state = buildBaseState({ rewriteApproved: false, pendingIssues: [] })

    const result = await converge_and_decide(state)

    expect(result.routingDecision).toBe('finalize_chapter')
    expect(result.rewriteApproved).toBe(false)
    expect(result.autoFixAttempts).toBe(0)
    expect(readChapterContent).toHaveBeenCalledWith('/tmp/story', 2)
  })

  it('drafts the chapter when there is no existing chapter file', async () => {
    vi.mocked(readChapterContent).mockResolvedValue(null)

    const state = buildBaseState({ rewriteApproved: false, pendingIssues: [] })
    const result = await converge_and_decide(state)

    expect(result.routingDecision).toBe('draft_chapter')
    expect(result.rewriteApproved).toBe(false)
  })

  it('routes to fix_chapter for local consistency errors when rewrite is approved', async () => {
    const { isLocalIssue, isStructuralIssue } = await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isLocalIssue).mockResolvedValue(true)
    vi.mocked(isStructuralIssue).mockResolvedValue(false)

    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '局部时间顺序不一致' },
    ]
    const state = buildBaseState({ rewriteApproved: true, pendingIssues })

    const result = await converge_and_decide(state)

    expect(result.routingDecision).toBe('fix_chapter')
    expect(result.rewriteApproved).toBe(true)
    expect(result.errorRewriteAttempts).toBe(1)
  })

  it('routes to draft_chapter and discards the plan for structural errors', async () => {
    const { isStructuralIssue, isLocalIssue } = await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isStructuralIssue).mockResolvedValue(true)
    vi.mocked(isLocalIssue).mockResolvedValue(false)

    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '整体情节与大纲严重偏离' },
    ]
    const state = buildBaseState({ rewriteApproved: true, pendingIssues })

    const result = await converge_and_decide(state)

    expect(result.routingDecision).toBe('draft_chapter')
    expect(result.chapterPlan).toBeNull()
    expect(result.errorRewriteAttempts).toBe(1)
  })

  it('requests rewrite after max error rewrite attempts', async () => {
    const { isStateCorruptionIssue } = await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isStateCorruptionIssue).mockResolvedValue(true)

    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '上游状态污染' },
    ]
    const state = buildBaseState({
      rewriteApproved: true,
      errorRewriteAttempts: 3,
      pendingIssues,
      previousIssues: [],
      previousRawErrorCount: 0,
    })

    const result = await converge_and_decide(state)

    expect(result.routingDecision).toBe('request_rewrite')
    expect(result.rewriteApproved).toBe(false)
  })

  it('stops rewrite loop early when issues are highly similar and involve state corruption', async () => {
    const { isStateCorruptionIssue } = await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isStateCorruptionIssue).mockResolvedValue(true)

    const pendingIssues: Issue[] = [
      { id: '1', type: 'state_corruption', severity: 'error', description: '大纲与权威事实冲突' },
    ]
    const state = buildBaseState({
      rewriteApproved: true,
      errorRewriteAttempts: 2,
      previousIssues: pendingIssues,
      previousRawErrorCount: 1,
      pendingIssues,
    })

    const result = await converge_and_decide(state)

    expect(result.routingDecision).toBe('request_rewrite')
    expect(result.rewriteApproved).toBe(false)
    expect(result.forceStructuralRewrite).toBe(false)
  })

  it('auto-fixes patchable warnings when no errors remain', async () => {
    const pendingIssues: Issue[] = [
      { id: 'w1', type: 'consistency', severity: 'warning', description: '描写重复', location: '第一段' },
    ]
    const state = buildBaseState({ rewriteApproved: true, pendingIssues, autoFixAttempts: 0 })

    const result = await converge_and_decide(state)

    expect(result.routingDecision).toBe('fix_chapter')
    expect(result.autoFixAttempts).toBe(1)
    expect(result.rewriteApproved).toBe(true)
    expect(result.pendingIssues).toEqual(pendingIssues)
  })

  it('preserves abstract quality warnings and finalizes instead of fixing them', async () => {
    const pendingIssues: Issue[] = [
      { id: 'w1', type: 'consistency', severity: 'warning', description: '情感层次略显单一，应该增加内心描写', dimension: 'quality' },
    ]
    // rewriteAttempts > 0 表示已经历过至少一次起草/验证循环
    const state = buildBaseState({ rewriteApproved: true, pendingIssues, autoFixAttempts: 0, rewriteAttempts: 1 })

    const result = await converge_and_decide(state)

    expect(result.routingDecision).toBe('finalize_chapter')
    expect(result.autoFixAttempts).toBe(0)
    expect(result.pendingIssues).toEqual(pendingIssues)
  })

  it('routes to draft_chapter on first iteration when rewrite is approved and chapter file is missing', async () => {
    vi.mocked(readChapterContent).mockResolvedValue(null)

    const state = buildBaseState({ rewriteApproved: true, pendingIssues: [], rewriteAttempts: 0 })
    const result = await converge_and_decide(state)

    expect(result.routingDecision).toBe('draft_chapter')
    expect(result.rewriteApproved).toBe(true)
  })

  it('does not auto-fix warnings when errors still exist', async () => {
    const { isLocalIssue, isStructuralIssue } = await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isLocalIssue).mockResolvedValue(true)
    vi.mocked(isStructuralIssue).mockResolvedValue(false)

    const warning: Issue = { id: 'w1', type: 'consistency', severity: 'warning', description: '描写重复', location: '第一段' }
    const error: Issue = { id: 'e1', type: 'consistency', severity: 'error', description: '时间顺序不一致' }
    const state = buildBaseState({ rewriteApproved: true, pendingIssues: [error, warning] })

    const result = await converge_and_decide(state)

    expect(result.routingDecision).toBe('fix_chapter')
    expect(result.pendingIssues?.some(i => i.id === 'w1')).toBe(true)
  })

  it('does not auto-fix warnings when max auto-fix attempts reached', async () => {
    const pendingIssues: Issue[] = [
      { id: 'w1', type: 'consistency', severity: 'warning', description: '描写重复', location: '第一段' },
    ]
    const state = buildBaseState({ rewriteApproved: true, pendingIssues, autoFixAttempts: 3, rewriteAttempts: 1 })

    const result = await converge_and_decide(state)

    expect(result.routingDecision).toBe('finalize_chapter')
    expect(result.autoFixAttempts).toBe(3)
    expect(result.pendingIssues).toEqual(pendingIssues)
  })
})

describe('route_by_decision', () => {
  it('returns the routingDecision already set on state', () => {
    const state = buildBaseState({ routingDecision: 'request_rewrite' })
    expect(route_by_decision(state)).toBe('request_rewrite')
  })

  it('falls back to finalize_chapter when routingDecision is missing', () => {
    const state = buildBaseState({ routingDecision: undefined })
    expect(route_by_decision(state)).toBe('finalize_chapter')
  })
})

describe('route_after_validation', () => {
  it('always routes back to converge_and_decide', () => {
    const state = buildBaseState()
    expect(route_after_validation(state)).toBe('converge_and_decide')
  })
})
