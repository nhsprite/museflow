import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReducedGraphState } from '../../src/graph/state.js'

const {
  planChapterWithOverrideMock,
  draftChapterMock,
  fixChapterMock,
  validateChapterMock,
  qualityPassMock,
  detectForeshadowingMock,
  detectHallucinationMock,
  detectConsistencyMock,
  verifyOutlineComplianceMock,
  autoFixWarningsMock,
  finalizeChapterMock,
} = vi.hoisted(() => ({
  planChapterWithOverrideMock: vi.fn(),
  draftChapterMock: vi.fn(),
  fixChapterMock: vi.fn(),
  validateChapterMock: vi.fn(),
  qualityPassMock: vi.fn(),
  detectForeshadowingMock: vi.fn(),
  detectHallucinationMock: vi.fn(),
  detectConsistencyMock: vi.fn(),
  verifyOutlineComplianceMock: vi.fn(),
  autoFixWarningsMock: vi.fn(),
  finalizeChapterMock: vi.fn(),
}))

vi.mock('../../src/graph/nodes.js', () => ({
  plan_chapter_with_override: planChapterWithOverrideMock,
  draft_chapter: draftChapterMock,
  fix_chapter: fixChapterMock,
  validate_chapter: validateChapterMock,
  quality_pass: qualityPassMock,
  detect_foreshadowing: detectForeshadowingMock,
  detect_hallucination: detectHallucinationMock,
  detect_consistency: detectConsistencyMock,
  verify_outline_compliance: verifyOutlineComplianceMock,
  auto_fix_warnings: autoFixWarningsMock,
  finalize_chapter: finalizeChapterMock,
}))

vi.mock('../../src/utils/id.js', () => ({ generateId: vi.fn().mockReturnValue('generated-id') }))

const baseState: ReducedGraphState = {
  story: { id: 'story-1', title: 'Story', outputDir: '/tmp/story' },
  idea: 'idea',
  genre: 'default',
  totalChapters: 2,
  world: null,
  characters: [],
  outline: [
    { number: 1, title: 'Chapter 1', description: '反派伏法，但后续仍需处理。' },
    { number: 2, title: 'Chapter 2', description: '众人继续辨别真相并完成最终处置。' },
  ],
  chapters: [null, null],
  currentChapterIndex: 0,
  foreshadowStack: [],
  chapterSummaries: [],
  pendingIssues: [],
  rewriteApproved: true,
  rewriteRequested: false,
  isWriting: true,
  writeOneChapterOnly: true,
  lastPrintedChapter: 0,
  lastTimelineSnapshot: null,
  chapterPlan: null,
  storyState: null,
  autoFixAttempts: 0,
}

describe('executeChapterGeneration outline bridge retries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: { sections: [] } })
    draftChapterMock.mockResolvedValue({ chapters: baseState.chapters, chapterPlan: { sections: [] } })
    fixChapterMock.mockResolvedValue({ chapters: baseState.chapters })
    validateChapterMock.mockResolvedValue({})
    qualityPassMock.mockResolvedValue({})
    detectForeshadowingMock.mockResolvedValue({})
    detectHallucinationMock.mockResolvedValue({})
    detectConsistencyMock.mockResolvedValue({})
    verifyOutlineComplianceMock.mockResolvedValue({})
    finalizeChapterMock.mockResolvedValue({ currentChapterIndex: 1 })
    autoFixWarningsMock
      .mockResolvedValueOnce({
        pendingIssues: [{
          id: 'issue-1',
          type: 'hallucination',
          severity: 'error' as const,
          description: '局部事实处理需要修正',
        }],
      })
      .mockResolvedValueOnce({ pendingIssues: [] })
  })

  it('uses targeted fix on retry when only local issues remain after bridge planning', async () => {
    const { executeChapterGeneration } = await import('../../src/core/chapter-generation.js')
    const graph = { updateState: vi.fn().mockResolvedValue(undefined) }
    const checkpointer = { saveChapterCheckpoint: vi.fn().mockResolvedValue(undefined) }

    await executeChapterGeneration(
      'story-1',
      '/tmp/story',
      baseState,
      graph as never,
      checkpointer as never,
      { maxRewriteAttempts: 2, enableRevalidation: false, enableStructuralBranching: true }
    )

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    expect(draftChapterMock).toHaveBeenCalledTimes(1)
    expect(fixChapterMock).toHaveBeenCalledTimes(1)
  })

  it('uses fix mode for local consistency errors on retry instead of replanning', async () => {
    autoFixWarningsMock
      .mockReset()
      .mockResolvedValueOnce({
        pendingIssues: [{
          id: 'issue-1',
          type: 'consistency',
          severity: 'error' as const,
          description: 'cross-chapter fact mismatch',
        }],
      })
      .mockResolvedValueOnce({ pendingIssues: [] })

    const { executeChapterGeneration } = await import('../../src/core/chapter-generation.js')
    const graph = { updateState: vi.fn().mockResolvedValue(undefined) }
    const checkpointer = { saveChapterCheckpoint: vi.fn().mockResolvedValue(undefined) }

    await executeChapterGeneration(
      'story-1',
      '/tmp/story',
      baseState,
      graph as never,
      checkpointer as never,
      { maxRewriteAttempts: 2, enableRevalidation: false, enableStructuralBranching: true }
    )

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    expect(fixChapterMock).toHaveBeenCalledTimes(1)
  })

  it('uses full rewrite for cross-chapter consistency errors that reference previous chapters', async () => {
    autoFixWarningsMock
      .mockReset()
      .mockResolvedValueOnce({
        pendingIssues: [{
          id: 'issue-1',
          type: 'consistency',
          severity: 'error' as const,
          description: '第29章中六耳猕猴已被封入锦囊，本章却写他被如来降伏',
        }],
      })
      .mockResolvedValueOnce({ pendingIssues: [] })

    const { executeChapterGeneration } = await import('../../src/core/chapter-generation.js')
    const graph = { updateState: vi.fn().mockResolvedValue(undefined) }
    const checkpointer = { saveChapterCheckpoint: vi.fn().mockResolvedValue(undefined) }

    await executeChapterGeneration(
      'story-1',
      '/tmp/story',
      baseState,
      graph as never,
      checkpointer as never,
      { maxRewriteAttempts: 2, enableRevalidation: false, enableStructuralBranching: true }
    )

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(0)
    expect(draftChapterMock).toHaveBeenCalledTimes(2)
    expect(fixChapterMock).toHaveBeenCalledTimes(0)
  })

  it('escalates to full rewrite when paragraph fix increases error count', async () => {
    autoFixWarningsMock
      .mockReset()
      .mockResolvedValueOnce({
        pendingIssues: [{
          id: 'issue-1',
          type: 'quality',
          severity: 'error' as const,
          description: '局部用词重复',
        }],
      })
      .mockResolvedValueOnce({
        pendingIssues: [
          {
            id: 'issue-1',
            type: 'quality',
            severity: 'error' as const,
            description: '局部用词重复',
          },
          {
            id: 'issue-2',
            type: 'quality',
            severity: 'error' as const,
            description: '新增局部节奏问题',
          },
        ],
      })
      .mockResolvedValueOnce({ pendingIssues: [] })

    const { executeChapterGeneration } = await import('../../src/core/chapter-generation.js')
    const graph = { updateState: vi.fn().mockResolvedValue(undefined) }
    const checkpointer = { saveChapterCheckpoint: vi.fn().mockResolvedValue(undefined) }

    await executeChapterGeneration(
      'story-1',
      '/tmp/story',
      baseState,
      graph as never,
      checkpointer as never,
      { maxRewriteAttempts: 3, enableRevalidation: false, enableStructuralBranching: true }
    )

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    expect(draftChapterMock).toHaveBeenCalledTimes(2)
    expect(fixChapterMock).toHaveBeenCalledTimes(1)
  })
})
