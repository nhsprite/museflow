import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReducedGraphState } from '../../src/graph/state.js'

const readChapterContent = vi.fn().mockResolvedValue(null)
const shouldForceTemporaryReplan = vi.fn().mockReturnValue(false)
const getChapterPlanningConfig = vi.fn().mockReturnValue({
  maxNonErrorIssuesPerType: 5,
  maxVerifiedConstraints: 10,
})

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  readChapterContent,
  writeChapterContent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/utils/outline-boundary.js', () => ({
  shouldForceTemporaryReplan,
}))

vi.mock('../../src/utils/chapter-planning.js', () => ({
  getChapterPlanningConfig,
}))

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../../src/core/chapter-generation/issue-classifier.js', () => ({
  isStructuralIssue: vi.fn().mockResolvedValue(false),
  isLocalIssue: vi.fn().mockResolvedValue(false),
  isTaskConsistencyIssue: vi.fn().mockResolvedValue(false),
  isStateCorruptionIssue: vi.fn().mockResolvedValue(false),
  isInterpretiveIssue: vi.fn().mockResolvedValue(false),
}))

vi.mock('../../src/utils/issue-deduplication.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/issue-deduplication.js')>()
  return {
    ...actual,
    deduplicateIssuesSemantically: vi.fn().mockImplementation(async (_provider: unknown, issues: unknown[]) => issues),
    issueFingerprint: vi.fn().mockResolvedValue('fingerprint'),
  }
})

vi.mock('../../src/model/registry.js', () => ({
  createProvider: vi.fn().mockReturnValue({ chat: vi.fn() }),
}))

function createBaseState(overrides: Record<string, unknown> = {}): ReducedGraphState {
  return {
    story: { id: 'story-1', title: 'Test', outputDir: '/tmp/test' },
    idea: 'test idea',
    genre: 'default',
    totalChapters: 3,
    world: null,
    characters: [],
    outline: [
      { number: 1, title: 'Chapter 1', description: 'Desc 1' },
      { number: 2, title: 'Chapter 2', description: 'Desc 2' },
      { number: 3, title: 'Chapter 3', description: 'Desc 3' },
    ],
    chapters: [null, null, null],
    currentChapterIndex: 0,
    foreshadowStack: [],
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: true,
    lastPrintedChapter: -1,
    lastTimelineSnapshot: null,
    chapterPlan: null,
    storyState: null,
    autoFixAttempts: 0,
    verifiedConstraints: [],
    rewriteAttempts: 0,
    errorRewriteAttempts: 0,
    previousIssues: [],
    previousRawErrorCount: 0,
    forceStructuralRewrite: false,
    routingDecision: undefined,
    ...overrides,
  } as ReducedGraphState
}

describe('convergence_check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stops rewrite loop early when issues are highly similar and involve state corruption', async () => {
    const { isStateCorruptionIssue } = await import('../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isStateCorruptionIssue).mockResolvedValue(true)

    const { convergence_check } = await import('../../src/graph/nodes/chapter-orchestration.js')

    const state = createBaseState({
      rewriteApproved: true,
      errorRewriteAttempts: 2,
      previousIssues: [{
        id: 'e1',
        type: 'state_corruption',
        severity: 'error',
        description: '大纲与权威事实冲突',
      }],
      previousRawErrorCount: 1,
      pendingIssues: [{
        id: 'e1',
        type: 'state_corruption',
        severity: 'error',
        description: '大纲与权威事实冲突',
      }],
    })

    const result = await convergence_check(state)

    expect(result.routingDecision).toBe('request_rewrite')
    expect(result.rewriteApproved).toBe(false)
    expect(result.forceStructuralRewrite).toBe(false)
  })
})

describe('decide_strategy', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    readChapterContent.mockResolvedValue(null)
    shouldForceTemporaryReplan.mockReturnValue(false)
    const { isStateCorruptionIssue } = await import('../../src/core/chapter-generation/issue-classifier.js')
    vi.mocked(isStateCorruptionIssue).mockResolvedValue(false)
  })

  it('routes to draft_chapter when chapter file does not exist', async () => {
    const { decide_strategy } = await import('../../src/graph/nodes/chapter-orchestration.js')

    readChapterContent.mockResolvedValue(null)

    const result = await decide_strategy(createBaseState({ currentChapterIndex: 1 }))

    expect(readChapterContent).toHaveBeenCalledWith('/tmp/test', 2)
    expect(result.routingDecision).toBe('draft_chapter')
  })

  it('routes to finalize_chapter when chapter file already exists', async () => {
    const { decide_strategy } = await import('../../src/graph/nodes/chapter-orchestration.js')

    readChapterContent.mockResolvedValue('existing chapter content')

    const result = await decide_strategy(createBaseState({ currentChapterIndex: 1 }))

    expect(readChapterContent).toHaveBeenCalledWith('/tmp/test', 2)
    expect(result.routingDecision).toBe('finalize_chapter')
  })

  it('routes to draft_chapter when rewrite is approved even if file exists', async () => {
    const { decide_strategy } = await import('../../src/graph/nodes/chapter-orchestration.js')

    readChapterContent.mockResolvedValue('existing chapter content')

    const result = await decide_strategy(createBaseState({
      currentChapterIndex: 1,
      rewriteApproved: true,
      pendingIssues: [{
        id: 'e1',
        type: 'quality',
        severity: 'error',
        description: 'quality error',
      }],
    }))

    expect(result.routingDecision).toBe('draft_chapter')
  })
})
