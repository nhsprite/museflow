import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReducedGraphState } from '../../src/graph/state.js'

const planChapterMock = vi.fn()
const draftChapterMock = vi.fn()
const fixChapterMock = vi.fn()
const validateChapterMock = vi.fn()
const qualityPassMock = vi.fn()
const detectForeshadowingMock = vi.fn()
const detectHallucinationMock = vi.fn()
const detectConsistencyMock = vi.fn()
const verifyOutlineComplianceMock = vi.fn()
const autoFixWarningsMock = vi.fn()
const finalizeChapterMock = vi.fn()

vi.mock('../../src/graph/nodes.js', () => ({
  plan_chapter: planChapterMock,
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
    planChapterMock.mockResolvedValue({ chapterPlan: { sections: [] } })
    draftChapterMock.mockResolvedValue({ chapters: baseState.chapters })
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

    expect(planChapterMock).toHaveBeenCalledTimes(1)
    expect(draftChapterMock).toHaveBeenCalledTimes(1)
    expect(fixChapterMock).toHaveBeenCalledTimes(1)
  })

  it('uses fix mode for consistency errors on retry instead of replanning', async () => {
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

    expect(planChapterMock).toHaveBeenCalledTimes(1)
    expect(fixChapterMock).toHaveBeenCalledTimes(1)
  })
})
