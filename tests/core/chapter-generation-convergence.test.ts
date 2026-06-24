import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReducedGraphState } from '../../src/graph/state.js'

const { draftChapterMock, fixChapterMock, planChapterWithOverrideMock, validateChapterMock, qualityPassMock, detectForeshadowingMock, detectHallucinationMock, detectConsistencyMock, verifyOutlineComplianceMock, autoFixWarningsMock } = vi.hoisted(() => ({
  draftChapterMock: vi.fn(),
  fixChapterMock: vi.fn(),
  planChapterWithOverrideMock: vi.fn(),
  validateChapterMock: vi.fn(),
  qualityPassMock: vi.fn(),
  detectForeshadowingMock: vi.fn(),
  detectHallucinationMock: vi.fn(),
  detectConsistencyMock: vi.fn(),
  verifyOutlineComplianceMock: vi.fn(),
  autoFixWarningsMock: vi.fn(),
}))

vi.mock('../../src/graph/nodes.js', () => ({
  draft_chapter: draftChapterMock,
  fix_chapter: fixChapterMock,
  plan_chapter_with_override: planChapterWithOverrideMock,
  validate_chapter: validateChapterMock,
  quality_pass: qualityPassMock,
  detect_foreshadowing: detectForeshadowingMock,
  detect_hallucination: detectHallucinationMock,
  detect_consistency: detectConsistencyMock,
  verify_outline_compliance: verifyOutlineComplianceMock,
  auto_fix_warnings: autoFixWarningsMock,
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  readChapterContent: vi.fn().mockResolvedValue('existing'),
  writeChapterContent: vi.fn(),
}))

const baseState: ReducedGraphState = {
  story: { id: 'story-1', title: 'Story', outputDir: '/tmp/story' },
  idea: 'idea',
  genre: 'default',
  totalChapters: 2,
  world: null,
  characters: [{ id: '1', storyId: 'story-1', name: '苏半城', description: '', createdAt: 1 }],
  outline: [
    { number: 1, title: 'Chapter 1', description: '第一章' },
    { number: 2, title: 'Chapter 2', description: '第二章' },
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
  verifiedConstraints: [],
}

describe('executeChapterGeneration state corruption detection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    draftChapterMock.mockResolvedValue({ chapters: baseState.chapters })
    fixChapterMock.mockResolvedValue({ chapters: baseState.chapters })
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: { sections: [] } })
    validateChapterMock.mockResolvedValue({})
    qualityPassMock.mockResolvedValue({})
    detectForeshadowingMock.mockResolvedValue({})
    detectHallucinationMock.mockResolvedValue({})
    detectConsistencyMock.mockResolvedValue({})
    verifyOutlineComplianceMock.mockResolvedValue({})
    autoFixWarningsMock.mockResolvedValue({ pendingIssues: [] })
  })

  it('emits state_corruption error when invented-character errors persist', async () => {
    autoFixWarningsMock.mockResolvedValue({
      pendingIssues: [{
        id: 'inv',
        type: 'hallucination',
        severity: 'error' as const,
        description: '苏半城称胞兄为陆廷樑，陆廷樑不在官方角色列表中',
      }],
    })

    const { executeChapterGeneration } = await import('../../src/core/chapter-generation.js')
    const graph = { updateState: vi.fn().mockResolvedValue(undefined) }
    const checkpointer = { saveChapterCheckpoint: vi.fn().mockResolvedValue(undefined) }

    const result = await executeChapterGeneration(
      'story-1',
      '/tmp/story',
      baseState,
      graph as never,
      checkpointer as never,
      { maxRewriteAttempts: 2, enableRevalidation: false, enableStructuralBranching: true }
    )

    expect(result.pendingIssues.some(i => i.type === 'state_corruption')).toBe(true)
  })
})
