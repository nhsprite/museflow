import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testTempDir = join(tmpdir(), `museflow-write-${randomUUID().slice(0, 8)}`)

const runOneChapterMock = vi.fn().mockResolvedValue({
  story: { id: 'story-1', outputDir: testTempDir },
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
    story: { id: 'story-1', outputDir: testTempDir },
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
  runOneChapter: runOneChapterMock,
  getState: getStateMock,
}))

vi.mock('../../src/storage/meta/stores/story.js', () => ({
  getStory: vi.fn().mockReturnValue({
    id: 'story-1',
    title: 'Test Story',
    outputDir: testTempDir,
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
  printChapterReport: vi.fn(),
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
    runOneChapterMock.mockResolvedValue({
      story: { id: 'story-1', outputDir: testTempDir },
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

  it('calls runOneChapter in draft mode', async () => {
    const { write } = await import('../../src/cli/commands/write.ts')

    await write('story-1', { storyId: 'story-1' })

    expect(runOneChapterMock).toHaveBeenCalledTimes(1)
    expect(runOneChapterMock).toHaveBeenCalledWith('story-1', { mode: 'draft', targetChapterIndex: 0 })
  })

})
