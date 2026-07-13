import { describe, expect, it, vi, beforeEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  converge_and_decide,
  route_by_decision,
  route_after_validation,
  route_after_finalize,
} from '../../../src/graph/nodes/chapter-orchestration.js'
import { readChapterContentForRun } from '../../../src/storage/filesystem/writer.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { Issue } from '../../../src/types/agent.js'
import type { ChapterSession } from '../../../src/core/chapter-generation/routing/types.js'
import type { ModelProvider } from '../../../src/model/provider.js'
import type { RuntimeContext } from '../../../src/core/context.js'
import { JsonCheckpointer } from '../../../src/graph/checkpointer.js'
import { generateIssueFingerprint } from '../../../src/utils/context-judge.js'

const testTempDir = join(tmpdir(), `museflow-chapter-orchestration-${randomUUID().slice(0, 8)}`)

vi.mock('../../../src/storage/filesystem/writer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/filesystem/writer.js')>()
  return {
    ...actual,
    readChapterContent: vi.fn().mockResolvedValue('existing chapter content'),
    readChapterContentForRun: vi.fn().mockResolvedValue('existing chapter content'),
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
  isStructuralIssue: vi.fn().mockReturnValue(false),
  isLocalIssue: vi.fn().mockReturnValue(false),
  isTaskConsistencyIssue: vi.fn().mockReturnValue(false),
  isStateCorruptionIssue: vi.fn().mockReturnValue(false),
  isInterpretiveIssue: vi.fn().mockReturnValue(false),
}))

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
    chapterPlan: {
      chapterIndex: 1,
      sections: [],
      timeline: [],
      outlineCheck: [],
      expectedEvents: [],
      claimedBeatIds: [],
      fulfilledForeshadowIds: [],
      introducedForeshadowIds: [],
      resolvedTaskIds: [],
      createdTaskIds: [],
    },
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
    vi.mocked(readChapterContentForRun).mockResolvedValue('existing chapter content')
    const {
      isStructuralIssue,
      isLocalIssue,
      isTaskConsistencyIssue,
      isStateCorruptionIssue,
      isInterpretiveIssue,
    } = await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isStructuralIssue).mockReturnValue(false)
    vi.mocked(isLocalIssue).mockReturnValue(false)
    vi.mocked(isTaskConsistencyIssue).mockReturnValue(false)
    vi.mocked(isStateCorruptionIssue).mockReturnValue(false)
    vi.mocked(isInterpretiveIssue).mockReturnValue(false)
  })

  it('finalizes when there are no errors and a chapter file already exists', async () => {
    const state = buildBaseState({ session: { rewriteApproved: false }, pendingIssues: [] })

    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('finalize_chapter')
    expect(result.session?.rewriteApproved).toBe(false)
    expect(result.session?.autoFixAttempts).toBe(0)
    expect(readChapterContentForRun).toHaveBeenCalledWith(testTempDir, 2)
  })

  it('drafts the chapter when there is no existing chapter file', async () => {
    vi.mocked(readChapterContentForRun).mockResolvedValue(null)

    const state = buildBaseState({ session: { rewriteApproved: false }, pendingIssues: [] })
    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('draft_chapter')
    expect(result.session?.rewriteApproved).toBe(false)
  })

  it('routes to fix_chapter for local consistency errors when rewrite is approved', async () => {
    const { isLocalIssue, isStructuralIssue } =
      await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isLocalIssue).mockReturnValue(true)
    vi.mocked(isStructuralIssue).mockReturnValue(false)

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
    vi.mocked(isStructuralIssue).mockReturnValue(true)
    vi.mocked(isLocalIssue).mockReturnValue(false)

    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '整体情节与大纲严重偏离' },
    ]
    const state = buildBaseState({ session: { rewriteApproved: true }, pendingIssues })

    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('draft_chapter')
    expect(result.chapterPlan).toBeNull()
    expect(result.session?.errorRewriteAttempts).toBe(1)
  })

  it('routes to repair_state on the first all-state-corruption rewrite round', async () => {
    const { isStateCorruptionIssue } =
      await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isStateCorruptionIssue).mockReturnValue(true)

    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '上游状态污染' },
    ]
    const state = buildBaseState({
      session: {
        rewriteApproved: true,
        errorRewriteAttempts: 1,
        previousIssues: [],
        previousRawErrorCount: 0,
      },
      pendingIssues,
    })

    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.routingDecision).toBe('repair_state')
    expect(result.session?.stateRepairAttempts).toBe(1)
    expect(result.session?.rewriteApproved).toBe(true)
    expect(result.blockingReport).toBeUndefined()
  })

  it('requests rewrite after max error rewrite attempts', async () => {
    const { isStateCorruptionIssue } =
      await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isStateCorruptionIssue).mockReturnValue(true)

    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '上游状态污染' },
    ]
    const state = buildBaseState({
      session: {
        rewriteApproved: true,
        errorRewriteAttempts: 3,
        previousIssues: [],
        previousRawErrorCount: 0,
        stateRepairAttempts: 2,
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
    vi.mocked(isStateCorruptionIssue).mockReturnValue(true)

    const pendingIssues: Issue[] = [
      { id: '1', type: 'state_corruption', severity: 'error', description: '大纲与权威事实冲突' },
    ]
    const state = buildBaseState({
      session: {
        rewriteApproved: true,
        errorRewriteAttempts: 2,
        previousIssues: pendingIssues,
        previousRawErrorCount: 1,
        stateRepairAttempts: 2,
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
    vi.mocked(isStateCorruptionIssue).mockReturnValue(true)

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
        stateRepairAttempts: 2,
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
    const pendingIssues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: 'persistent contradiction' },
    ]
    const fingerprint = generateIssueFingerprint(pendingIssues[0]!)
    const state = buildBaseState({
      session: {
        rewriteApproved: true,
        errorRewriteAttempts: 2,
        issueFingerprintHistory: [[fingerprint], [fingerprint]],
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
    const pendingIssues: Issue[] = [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '应明确写出原定计划被改期的原因',
        subject: '同一对象',
      },
      {
        id: '2',
        type: 'consistency',
        severity: 'error',
        description: '应明确写出原定计划被改期的原因',
        subject: '同一对象',
      },
      {
        id: '3',
        type: 'consistency',
        severity: 'error',
        description: '应明确写出原定计划被改期的原因',
        subject: '同一对象',
      },
    ]
    const fingerprint = generateIssueFingerprint(pendingIssues[0]!)
    const state = buildBaseState({
      session: {
        rewriteApproved: true,
        errorRewriteAttempts: 2,
        issueFingerprintHistory: [[fingerprint], [fingerprint]],
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
    vi.mocked(readChapterContentForRun).mockResolvedValue(null)

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
    vi.mocked(isLocalIssue).mockReturnValue(true)
    vi.mocked(isStructuralIssue).mockReturnValue(false)

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

  it('writes back previousIssues and previousRawErrorCount for the next round', async () => {
    const { isLocalIssue } =
      await import('../../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isLocalIssue).mockReturnValue(true)

    const pendingIssues: Issue[] = [
      { id: 'e1', type: 'consistency', severity: 'error', description: '时间顺序不一致' },
      {
        id: 'w1',
        type: 'consistency',
        severity: 'warning',
        description: '描写重复',
        locationRef: { paragraphIndex: 0 },
      },
    ]
    const state = buildBaseState({
      session: { rewriteApproved: true },
      pendingIssues,
    })

    const result = await converge_and_decide(createMockContext(), state)

    expect(result.session?.previousIssues.map((i) => i.id)).toEqual(['e1', 'w1'])
    expect(result.session?.previousRawErrorCount).toBe(1)
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

describe('route_after_finalize', () => {
  it('routes to request_rewrite when rewriteRequested is true', () => {
    const state = buildBaseState({ rewriteRequested: true, writeOneChapterOnly: false })
    expect(route_after_finalize(state)).toBe('request_rewrite')
  })

  it('still routes to request_rewrite even when writeOneChapterOnly is true', () => {
    const state = buildBaseState({ rewriteRequested: true, writeOneChapterOnly: true })
    expect(route_after_finalize(state)).toBe('request_rewrite')
  })

  it('routes to finalize_story when writeOneChapterOnly is true and no rewrite requested', () => {
    const state = buildBaseState({ rewriteRequested: false, writeOneChapterOnly: true })
    expect(route_after_finalize(state)).toBe('finalize_story')
  })

  it('routes to prepare_chapter when more chapters remain and no rewrite requested', () => {
    const state = buildBaseState({
      rewriteRequested: false,
      writeOneChapterOnly: false,
      currentChapterIndex: 1,
      totalChapters: 3,
    })
    expect(route_after_finalize(state)).toBe('prepare_chapter')
  })

  it('routes to finalize_story when all chapters are written and no rewrite requested', () => {
    const state = buildBaseState({
      rewriteRequested: false,
      writeOneChapterOnly: false,
      currentChapterIndex: 3,
      totalChapters: 3,
    })
    expect(route_after_finalize(state)).toBe('finalize_story')
  })
})
