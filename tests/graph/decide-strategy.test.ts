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
  isStructuralIssue: vi.fn().mockReturnValue(false),
  isLocalIssue: vi.fn().mockReturnValue(false),
  isTaskConsistencyIssue: vi.fn().mockReturnValue(false),
}))

vi.mock('../../src/utils/issue-deduplication.js', () => ({
  deduplicateIssuesSemantically: vi.fn((issues: unknown[]) => issues),
  issueFingerprint: vi.fn((issue: { description: string }) => issue.description),
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

describe('decide_strategy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readChapterContent.mockResolvedValue(null)
    shouldForceTemporaryReplan.mockReturnValue(false)
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
