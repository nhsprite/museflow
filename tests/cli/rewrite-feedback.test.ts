import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeChapterGenerationMock = vi.fn()
const clearPendingWritesMock = vi.fn().mockResolvedValue(undefined)
const deleteChapterContentMock = vi.fn().mockResolvedValue(undefined)
const getStoryStateMock = vi.fn().mockReturnValue(null)
const getChapterCheckpointMock = vi.fn().mockResolvedValue(null)

const initialState = {
  story: { id: 'story-1', outputDir: '/tmp/test-story' },
  idea: 'test',
  genre: 'default',
  totalChapters: 10,
  world: null,
  characters: [],
  outline: Array.from({ length: 10 }, (_, i) => ({
    number: i + 1,
    title: `Chapter ${i + 1}`,
    description: `Description ${i + 1}`,
  })),
  chapters: Array(10).fill(null),
  currentChapterIndex: 5,
  foreshadowStack: [],
  chapterSummaries: [],
  pendingIssues: [
    {
      id: 'issue-1',
      type: 'consistency',
      severity: 'error' as const,
      description: '需要重新规划本章结构',
      location: '结尾段落',
      suggestion: '删除新增角色并重新安排伏法结局',
    },
  ],
  rewriteApproved: false,
  rewriteRequested: true,
  isWriting: true,
  writeOneChapterOnly: true,
  lastPrintedChapter: 0,
  lastTimelineSnapshot: null,
  chapterPlan: null,
  storyState: null,
  autoFixAttempts: 0,
}

vi.mock('../../src/storage/database/dao/story.js', () => ({
  getStory: vi.fn().mockReturnValue({
    id: 'story-1',
    title: 'Test Story',
    outputDir: '/tmp/test-story',
  }),
  updateStoryStatus: vi.fn(),
  initStoryDb: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/core/runner.js', () => ({
  getState: vi.fn().mockResolvedValue(initialState),
  getOutputDirFromStoryId: vi.fn().mockReturnValue('/tmp/test-story'),
  getGraph: vi.fn().mockReturnValue({
    getState: vi.fn().mockResolvedValue({
      values: {
        ...initialState,
        pendingIssues: [],
      },
    }),
    updateState: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('../../src/core/chapter-generation.js', () => ({
  executeChapterGeneration: executeChapterGenerationMock,
}))

vi.mock('../../src/graph/checkpointer.js', () => ({
  getCheckpointer: () => ({
    clearPendingWrites: clearPendingWritesMock,
    saveChapterCheckpoint: vi.fn().mockResolvedValue(undefined),
    pruneIntermediateCheckpoints: vi.fn().mockResolvedValue(undefined),
    getChapterCheckpoint: getChapterCheckpointMock,
  }),
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  deleteChapterContent: deleteChapterContentMock,
}))

vi.mock('../../src/storage/database/dao/story-state.js', () => ({
  getStoryState: getStoryStateMock,
}))

vi.mock('../../src/cli/utils/spinner.js', () => ({
  withSpinner: vi.fn().mockImplementation(async (_msg, fn) => fn()),
  stopStepProgress: vi.fn(),
  stopStepProgressQuiet: vi.fn(),
}))

vi.mock('../../src/utils/chapter-display.js', () => ({
  printChapterOutline: vi.fn(),
}))

describe('rewrite command retry feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeChapterGenerationMock.mockImplementation(async (_storyId, _outputDir, workingState) => ({
      ...workingState,
      rewriteRequested: true,
      pendingIssues: workingState.pendingIssues,
    }))
  })

  it('preserves pending issues and enables structural branching for manual rewrite retries', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')

    await rewrite('story-1', { storyId: 'story-1' })

    expect(executeChapterGenerationMock).toHaveBeenCalledTimes(1)

    const call = executeChapterGenerationMock.mock.calls[0]
    const workingState = call?.[2]
    const options = call?.[5]

    expect(workingState?.pendingIssues).toEqual(initialState.pendingIssues)
    expect(options).toMatchObject({
      enableStructuralBranching: true,
    })
  })
})
