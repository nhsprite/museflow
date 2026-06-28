import { beforeEach, describe, expect, it, vi } from 'vitest'

const runOneChapterMock = vi.fn()

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

vi.mock('../../src/storage/meta/stores/story.js', () => ({
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
  runOneChapter: runOneChapterMock,
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
    runOneChapterMock.mockImplementation(async (_storyId, options) => ({
      ...initialState,
      rewriteRequested: true,
      pendingIssues: options.retryIssues ?? [],
    }))
  })

  it('preserves pending issues and enables structural branching for manual rewrite retries', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')

    await rewrite('story-1', { storyId: 'story-1' })

    expect(runOneChapterMock).toHaveBeenCalledTimes(1)

    const options = runOneChapterMock.mock.calls[0]?.[1]

    expect(options?.retryIssues).toEqual(initialState.pendingIssues)
    expect(options?.userResponse).toBe(true)
    expect(options?.mode).toBe('rewrite')
  })
})
