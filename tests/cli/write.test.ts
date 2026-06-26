import { beforeEach, describe, expect, it, vi } from 'vitest'

const continueStoryMock = vi.fn().mockResolvedValue({
  story: { id: 'story-1', outputDir: '/tmp/test-story' },
  currentChapterIndex: 1,
  totalChapters: 3,
  pendingIssues: [],
  rewriteRequested: false,
  outline: [
    { number: 1, title: 'Chapter 1', description: 'Desc 1' },
    { number: 2, title: 'Chapter 2', description: 'Desc 2' },
    { number: 3, title: 'Chapter 3', description: 'Desc 3' },
  ],
})

function createState(overrides: Record<string, unknown> = {}) {
  return {
    story: { id: 'story-1', outputDir: '/tmp/test-story' },
    idea: 'test',
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
    ...overrides,
  }
}

const getStateMock = vi.fn().mockResolvedValue(createState())

const loadPendingWritesForThreadMock = vi.fn().mockResolvedValue([])
const clearPendingWritesMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../../src/core/runner.js', () => ({
  continueStory: continueStoryMock,
  getState: getStateMock,
}))

vi.mock('../../src/storage/database/dao/story.js', () => ({
  getStory: vi.fn().mockReturnValue({
    id: 'story-1',
    title: 'Test Story',
    outputDir: '/tmp/test-story',
    status: 'writing',
  }),
  updateStoryStatus: vi.fn(),
  initStoryDb: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/graph/checkpointer.js', () => ({
  getCheckpointer: () => ({
    loadPendingWritesForThread: loadPendingWritesForThreadMock,
    clearPendingWrites: clearPendingWritesMock,
  }),
}))

vi.mock('../../src/cli/utils/spinner.js', () => ({
  withSpinner: vi.fn().mockImplementation(async (_msg: string, fn: () => Promise<unknown>) => fn()),
  startSpinner: vi.fn(),
  stopSpinner: vi.fn(),
  stopSpinnerQuiet: vi.fn(),
  stopStepProgress: vi.fn(),
  stopStepProgressQuiet: vi.fn(),
}))

vi.mock('../../src/cli/utils/chapter-display.js', () => ({
  printChapterOutline: vi.fn().mockReturnValue(true),
}))

vi.mock('../../src/utils/paths.js', () => ({
  getChapterFilePath: vi.fn().mockImplementation((outputDir: string, chapterNumber: number) => `${outputDir}/chapter_${chapterNumber}.md`),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
}))

describe('write command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    continueStoryMock.mockResolvedValue({
      story: { id: 'story-1', outputDir: '/tmp/test-story' },
      currentChapterIndex: 1,
      totalChapters: 3,
      pendingIssues: [],
      rewriteRequested: false,
      outline: [
        { number: 1, title: 'Chapter 1', description: 'Desc 1' },
        { number: 2, title: 'Chapter 2', description: 'Desc 2' },
        { number: 3, title: 'Chapter 3', description: 'Desc 3' },
      ],
    })
  })

  it('calls continueStory with isRewrite false', async () => {
    const { write } = await import('../../src/cli/commands/write.ts')

    await write('story-1', { storyId: 'story-1' })

    expect(continueStoryMock).toHaveBeenCalledTimes(1)
    expect(continueStoryMock).toHaveBeenCalledWith('story-1', undefined, 0, { isRewrite: false })
  })

})
