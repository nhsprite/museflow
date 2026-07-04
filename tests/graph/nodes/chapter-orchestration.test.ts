import { describe, expect, it, vi, beforeEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  converge_and_decide,
  route_by_decision,
  route_after_validation,
} from '../../../src/graph/nodes/chapter-orchestration.js'
import { readChapterContent } from '../../../src/storage/filesystem/writer.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { Issue } from '../../../src/types/agent.js'
import type { ChapterSession } from '../../../src/core/chapter-generation/routing/types.js'
import type { ModelProvider } from '../../../src/model/provider.js'
import type { RuntimeContext } from '../../../src/core/context.js'
import { JsonCheckpointer } from '../../../src/graph/checkpointer.js'

const testTempDir = join(tmpdir(), `museflow-chapter-orchestration-${randomUUID().slice(0, 8)}`)

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
    deduplicateIssuesSemantically: vi
      .fn()
      .mockImplementation(async (_provider: unknown, issues: unknown[]) => issues),
    issueFingerprint: vi.fn().mockResolvedValue('fingerprint'),
  }
})

function createMockProvider(): ModelProvider {
  return { chat: vi.fn(), chatStructured: vi.fn().mockResolvedValue({}) }
}

function createMockContext(): RuntimeContext {
  return {
    provider: createMockProvider(),
    checkpointer: new JsonCheckpointer(),
    config: { model: { provider: 'openai', model: 'gpt-4o', temperature: 0.7, maxTokens: 8192 } },
  }
}

function buildBaseSession(overrides: Partial<ChapterSession> = {}): ChapterSession {
  return {
    chapterIndex: 1,
    rewriteAttempts: 0,
    errorRewriteAttempts: 0,
    autoFixAttempts: 0,
    previousIssues: [],
    previousRawErrorCount: 0,
    routingDecision: undefined,
    forceStructuralRewrite: false,
    rewriteApproved: false,
    issueFingerprintHistory: [],
    ...overrides,
  }
}

function buildBaseState(
  overrides: Partial<ReducedGraphState> & { session?: Partial<ChapterSession> } = {}
): ReducedGraphState {
  const { session: sessionOverrides, ...rest } = overrides
  return {
    story: { id: 'story-1', title: 'Story', outputDir: testTempDir },
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
    verifiedConstraints: [],
    session: buildBaseSession(sessionOverrides),
    authorDecisions: {},
    blockingReport: null,
    ...rest,
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
    const state = buildBaseState({ session: { rewriteApproved: false }, pendingIssues: [] })

    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('finalize_chapter')
    expect(result.session?.rewriteApproved).toBe(false)
    expect(result.session?.autoFixAttempts).toBe(0)
    expect(readChapterContent).toHaveBeenCalledWith(testTempDir, 2)
  })

  it('drafts the chapter when there is no existing chapter file', async () => {
    vi.mocked(readChapterContent).mockResolvedValue(null)

    const state = buildBaseState({ session: { rewriteApproved: false }, pendingIssues: [] })
    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('draft_chapter')
    expect(result.session?.rewriteApproved).toBe(false)
  })

  it('routes to fix_chapter for local consistency errors when rewrite is approved', async () => {
    const { isLocalIssue, isStructuralIssue } =
      await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isLocalIssue).mockResolvedValue(true)
    vi.mocked(isStructuralIssue).mockResolvedValue(false)

    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '局部时间顺序不一致' },
    ]
    const state = buildBaseState({ session: { rewriteApproved: true }, pendingIssues })

    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('fix_chapter')
    expect(result.session?.rewriteApproved).toBe(true)
    expect(result.session?.errorRewriteAttempts).toBe(1)
  })

  it('routes to draft_chapter and discards the plan for structural errors', async () => {
    const { isStructuralIssue, isLocalIssue } =
      await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isStructuralIssue).mockResolvedValue(true)
    vi.mocked(isLocalIssue).mockResolvedValue(false)

    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '整体情节与大纲严重偏离' },
    ]
    const state = buildBaseState({ session: { rewriteApproved: true }, pendingIssues })

    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('draft_chapter')
    expect(result.chapterPlan).toBeNull()
    expect(result.session?.errorRewriteAttempts).toBe(1)
  })

  it('requests rewrite after max error rewrite attempts', async () => {
    const { isStateCorruptionIssue } =
      await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isStateCorruptionIssue).mockResolvedValue(true)

    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '上游状态污染' },
    ]
    const state = buildBaseState({
      session: {
        rewriteApproved: true,
        errorRewriteAttempts: 3,
        previousIssues: [],
        previousRawErrorCount: 0,
      },
      pendingIssues,
    })

    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('request_rewrite')
    expect(result.session?.rewriteApproved).toBe(false)
  })

  it('stops rewrite loop early when issues are highly similar and involve state corruption', async () => {
    const { isStateCorruptionIssue } =
      await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isStateCorruptionIssue).mockResolvedValue(true)

    const pendingIssues: Issue[] = [
      { id: '1', type: 'state_corruption', severity: 'error', description: '大纲与权威事实冲突' },
    ]
    const state = buildBaseState({
      session: {
        rewriteApproved: true,
        errorRewriteAttempts: 2,
        previousIssues: pendingIssues,
        previousRawErrorCount: 1,
      },
      pendingIssues,
    })

    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('request_rewrite')
    expect(result.session?.rewriteApproved).toBe(false)
    expect(result.session?.forceStructuralRewrite).toBe(false)
  })

  it('does not suggest unavailable reconcile commands in state-corruption blocking reports', async () => {
    const { isStateCorruptionIssue } =
      await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isStateCorruptionIssue).mockResolvedValue(true)

    const pendingIssues: Issue[] = [
      {
        id: '1',
        type: 'state_corruption',
        severity: 'error',
        description: '大纲与权威事实冲突，需要作者裁决',
      },
    ]
    const state = buildBaseState({
      session: {
        rewriteApproved: true,
        errorRewriteAttempts: 2,
        previousIssues: pendingIssues,
        previousRawErrorCount: 1,
      },
      pendingIssues,
    })

    const result = await converge_and_decide(createMockContext(), state)

    const descriptions =
      result.blockingReport?.suggestedActions.map((action) => action.description).join('\n') ?? ''
    expect(result.blockingReport?.reason).toBe('state_corruption')
    expect(descriptions).not.toContain('museflow reconcile')
    expect(descriptions).toContain('museflow rewrite')
  })

  it('detects rewrite loop stall and requests rewrite with a blocking report', async () => {
    const { issueFingerprint } = await import('../../../src/utils/issue-deduplication.js')
    vi.mocked(issueFingerprint).mockResolvedValue('stalled-fingerprint')

    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: 'persistent contradiction' },
    ]
    const state = buildBaseState({
      session: {
        rewriteApproved: true,
        errorRewriteAttempts: 2,
        issueFingerprintHistory: [['stalled-fingerprint'], ['stalled-fingerprint']],
      },
      pendingIssues,
    })

    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('request_rewrite')
    expect(result.session?.rewriteApproved).toBe(false)
    expect(result.blockingReport).not.toBeNull()
    expect(result.blockingReport?.reason).toBe('rewrite_loop_stalled')
    expect(result.blockingReport?.issues).toHaveLength(1)
  })

  it('deduplicates repeated issues in blocking report', async () => {
    const { issueFingerprint } = await import('../../../src/utils/issue-deduplication.js')
    vi.mocked(issueFingerprint).mockResolvedValue('stalled-fingerprint')

    const pendingIssues: Issue[] = [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '应明确写出原定计划被改期的原因',
      },
      {
        id: '2',
        type: 'consistency',
        severity: 'error',
        description: '应明确写出原定计划被改期的原因',
      },
      {
        id: '3',
        type: 'consistency',
        severity: 'error',
        description: '应明确写出原定计划被改期的原因',
      },
    ]
    const state = buildBaseState({
      session: {
        rewriteApproved: true,
        errorRewriteAttempts: 2,
        issueFingerprintHistory: [['stalled-fingerprint'], ['stalled-fingerprint']],
      },
      pendingIssues,
    })

    const result = await converge_and_decide(createMockContext(), state)

    expect(result.blockingReport).not.toBeNull()
    expect(result.blockingReport?.issues).toHaveLength(1)
    expect(result.blockingReport?.summary).toContain('1 个未解决错误')
  })

  it('auto-fixes patchable warnings when no errors remain', async () => {
    const pendingIssues: Issue[] = [
      {
        id: 'w1',
        type: 'consistency',
        severity: 'warning',
        description: '描写重复',
        location: '第一段',
        locationRef: { paragraphIndex: 0 },
      },
    ]
    const state = buildBaseState({
      session: { rewriteApproved: true, autoFixAttempts: 0 },
      pendingIssues,
    })

    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('fix_chapter')
    expect(result.session?.autoFixAttempts).toBe(1)
    expect(result.session?.rewriteApproved).toBe(true)
    expect(result.pendingIssues).toEqual(pendingIssues)
  })

  it('preserves abstract quality warnings and finalizes instead of fixing them', async () => {
    const pendingIssues: Issue[] = [
      {
        id: 'w1',
        type: 'consistency',
        severity: 'warning',
        description: '情感层次略显单一，应该增加内心描写',
        dimension: 'quality',
      },
    ]
    // rewriteAttempts > 0 表示已经历过至少一次起草/验证循环
    const state = buildBaseState({
      session: { rewriteApproved: true, autoFixAttempts: 0, rewriteAttempts: 1 },
      pendingIssues,
    })

    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('finalize_chapter')
    expect(result.session?.autoFixAttempts).toBe(0)
    expect(result.pendingIssues).toEqual(pendingIssues)
  })

  it('routes to draft_chapter on first iteration when rewrite is approved and chapter file is missing', async () => {
    vi.mocked(readChapterContent).mockResolvedValue(null)

    const state = buildBaseState({
      session: { rewriteApproved: true, rewriteAttempts: 0 },
      pendingIssues: [],
    })
    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('draft_chapter')
    expect(result.session?.rewriteApproved).toBe(true)
  })

  it('does not auto-fix warnings when errors still exist', async () => {
    const { isLocalIssue, isStructuralIssue } =
      await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isLocalIssue).mockResolvedValue(true)
    vi.mocked(isStructuralIssue).mockResolvedValue(false)

    const warning: Issue = {
      id: 'w1',
      type: 'consistency',
      severity: 'warning',
      description: '描写重复',
      location: '第一段',
      locationRef: { paragraphIndex: 0 },
    }
    const error: Issue = {
      id: 'e1',
      type: 'consistency',
      severity: 'error',
      description: '时间顺序不一致',
    }
    const state = buildBaseState({
      session: { rewriteApproved: true },
      pendingIssues: [error, warning],
    })

    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('fix_chapter')
    expect(result.pendingIssues?.some((i) => i.id === 'w1')).toBe(true)
  })

  it('does not auto-fix warnings when max auto-fix attempts reached', async () => {
    const pendingIssues: Issue[] = [
      {
        id: 'w1',
        type: 'consistency',
        severity: 'warning',
        description: '描写重复',
        location: '第一段',
        locationRef: { paragraphIndex: 0 },
      },
    ]
    const state = buildBaseState({
      session: { rewriteApproved: true, autoFixAttempts: 3, rewriteAttempts: 1 },
      pendingIssues,
    })

    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('finalize_chapter')
    expect(result.session?.autoFixAttempts).toBe(3)
    expect(result.pendingIssues).toEqual(pendingIssues)
  })
})

describe('route_by_decision', () => {
  it('returns the routingDecision already set on state', () => {
    const state = buildBaseState({ session: { routingDecision: 'request_rewrite' } })
    expect(route_by_decision(state)).toBe('request_rewrite')
  })

  it('falls back to finalize_chapter when routingDecision is missing', () => {
    const state = buildBaseState({ session: { routingDecision: undefined } })
    expect(route_by_decision(state)).toBe('finalize_chapter')
  })
})

describe('route_after_validation', () => {
  it('always routes back to converge_and_decide', () => {
    const state = buildBaseState()
    expect(route_after_validation(state)).toBe('converge_and_decide')
  })
})
