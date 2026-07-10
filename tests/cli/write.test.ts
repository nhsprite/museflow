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
const getStoryMock = vi.fn().mockReturnValue({
  id: 'story-1',
  title: 'Test Story',
  outputDir: testTempDir,
  status: 'writing',
})
const updateStoryStatusMock = vi.fn()
const updateStoryRuntimeStatusMock = vi.fn().mockResolvedValue(undefined)

const loadPendingWritesForThreadMock = vi.fn().mockResolvedValue([])
const clearPendingWritesMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../../src/core/runner.js', () => ({
  runOneChapter: runOneChapterMock,
  getState: getStateMock,
  updateStoryRuntimeStatus: updateStoryRuntimeStatusMock,
}))

vi.mock('../../src/storage/meta/stores/story.js', () => ({
  getStory: getStoryMock,
  updateStoryStatus: updateStoryStatusMock,
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
}))

vi.mock('../../src/cli/utils/chapter-display.js', () => ({
  printChapterOutline: vi.fn().mockReturnValue(true),
  printChapterReport: vi.fn(),
  printActProgress: vi.fn(),
}))

vi.mock('../../src/utils/paths.js', () => ({
  getChapterFilePath: vi
    .fn()
    .mockImplementation(
      (outputDir: string, chapterNumber: number) => `${outputDir}/chapter_${chapterNumber}.md`
    ),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
}))

describe('write command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getStateMock.mockResolvedValue(createState())
    getStoryMock.mockReturnValue({
      id: 'story-1',
      title: 'Test Story',
      outputDir: testTempDir,
      status: 'writing',
    })
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
    const { printActProgress } = await import('../../src/cli/utils/chapter-display.js')

    await write('story-1', { storyId: 'story-1' })

    expect(runOneChapterMock).toHaveBeenCalledTimes(1)
    expect(runOneChapterMock).toHaveBeenCalledWith('story-1', {
      mode: 'draft',
      targetChapterIndex: 0,
    })
    expect(printActProgress).toHaveBeenCalledWith(
      expect.objectContaining({ currentChapterIndex: 0 }),
      0
    )
  })

  it('sets story status to freeze after writing the final chapter', async () => {
    const { write } = await import('../../src/cli/commands/write.ts')

    getStateMock.mockResolvedValue(createState({ currentChapterIndex: 2 }))
    runOneChapterMock.mockResolvedValue({
      story: { id: 'story-1', outputDir: testTempDir },
      currentChapterIndex: 3,
      totalChapters: 3,
      pendingIssues: [],
      rewriteRequested: false,
      outline: [
        { number: 1, title: 'Chapter 1', description: 'Desc 1' },
        { number: 2, title: 'Chapter 2', description: 'Desc 2' },
        { number: 3, title: 'Chapter 3', description: 'Desc 3' },
      ],
    })

    await write('story-1', { storyId: 'story-1' })

    expect(updateStoryRuntimeStatusMock).toHaveBeenCalledWith('story-1', 'freeze')
  })

  it('does not write when the story is frozen', async () => {
    const { write } = await import('../../src/cli/commands/write.ts')

    getStoryMock.mockReturnValue({
      id: 'story-1',
      title: 'Test Story',
      outputDir: testTempDir,
      status: 'freeze',
    })
    getStateMock.mockResolvedValue(createState({ currentChapterIndex: 1 }))

    await write('story-1', { storyId: 'story-1' })

    expect(runOneChapterMock).not.toHaveBeenCalled()
  })
})
