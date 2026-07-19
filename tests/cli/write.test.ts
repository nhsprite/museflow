import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'

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
  const totalChapters = typeof overrides.totalChapters === 'number' ? overrides.totalChapters : 3
  return {
    story: { id: 'story-1', outputDir: testTempDir },
    idea: 'test',
    genre: 'default',
    totalChapters: 3,
    storyArc: {
      totalChapters,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: totalChapters,
          title: 'Story',
          theme: '',
          function: '',
          mandatoryBeats: [],
        },
      ],
      keyBeats: [],
    },
    storyMemory: createEmptyStoryMemory(),
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
  printIssues: vi.fn(),
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
    getStateMock.mockReset().mockResolvedValue(createState())
    getStoryMock.mockReset().mockReturnValue({
      id: 'story-1',
      title: 'Test Story',
      outputDir: testTempDir,
      status: 'writing',
    })
    runOneChapterMock.mockReset().mockResolvedValue({
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

  it('writes multiple chapters and reloads persisted state before each chapter', async () => {
    const { write } = await import('../../src/cli/commands/write.ts')

    getStateMock
      .mockResolvedValueOnce(createState({ currentChapterIndex: 0, totalChapters: 4 }))
      .mockResolvedValueOnce(createState({ currentChapterIndex: 1, totalChapters: 4 }))
      .mockResolvedValueOnce(createState({ currentChapterIndex: 2, totalChapters: 4 }))
    runOneChapterMock
      .mockResolvedValueOnce({
        ...createState({ currentChapterIndex: 1, totalChapters: 4 }),
        rewriteRequested: false,
      })
      .mockResolvedValueOnce({
        ...createState({ currentChapterIndex: 2, totalChapters: 4 }),
        rewriteRequested: false,
      })
      .mockResolvedValueOnce({
        ...createState({ currentChapterIndex: 3, totalChapters: 4 }),
        rewriteRequested: false,
      })

    await write('story-1', { storyId: 'story-1', count: 3 })

    expect(getStateMock).toHaveBeenCalledTimes(3)
    expect(runOneChapterMock).toHaveBeenCalledTimes(3)
    expect(runOneChapterMock.mock.calls.map((call) => call[1].targetChapterIndex)).toEqual([
      0, 1, 2,
    ])
  })

  it('stops a multi-chapter write when the current chapter requests a rewrite', async () => {
    const { write } = await import('../../src/cli/commands/write.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    runOneChapterMock.mockResolvedValue({
      ...createState({ currentChapterIndex: 0 }),
      rewriteRequested: true,
      pendingIssues: [{ type: 'continuity', severity: 'error', description: 'blocked' }],
    })

    await write('story-1', { storyId: 'story-1', count: 3 })

    expect(runOneChapterMock).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('[MuseFlow] 连续写作结束：计划 3 章 / 完成 0 章')
    expect(logSpy).toHaveBeenCalledWith('  停止原因：当前章节需要重写')
    logSpy.mockRestore()
  })

  it('stops a multi-chapter write when a successful run makes no chapter progress', async () => {
    const { write } = await import('../../src/cli/commands/write.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    runOneChapterMock.mockResolvedValue({
      ...createState({ currentChapterIndex: 0 }),
      rewriteRequested: false,
    })

    await write('story-1', { storyId: 'story-1', count: 3 })

    expect(runOneChapterMock).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('  停止原因：章节未产生进度')
    logSpy.mockRestore()
  })

  it('stops before drafting when persisted state has blocking issues', async () => {
    const { write } = await import('../../src/cli/commands/write.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    getStateMock.mockResolvedValue(
      createState({
        rewriteRequested: true,
        pendingIssues: [{ type: 'continuity', severity: 'error', description: 'blocked' }],
      })
    )

    await write('story-1', { storyId: 'story-1', count: 3 })

    expect(runOneChapterMock).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('  停止原因：当前章节存在严重问题')
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('resumes the chapter loop when an interrupted run left error issues without a rewrite request', async () => {
    const { write } = await import('../../src/cli/commands/write.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    getStateMock.mockResolvedValue(
      createState({
        rewriteRequested: false,
        pendingIssues: [{ type: 'consistency', severity: 'error', description: 'leftover' }],
      })
    )

    await write('story-1', { storyId: 'story-1' })

    expect(runOneChapterMock).toHaveBeenCalledTimes(1)
    expect(runOneChapterMock).toHaveBeenCalledWith('story-1', {
      mode: 'draft',
      targetChapterIndex: 0,
    })
    logSpy.mockRestore()
  })

  it('counts a committed chapter and then stops when validation leaves blocking issues', async () => {
    const { write } = await import('../../src/cli/commands/write.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    runOneChapterMock.mockResolvedValue({
      ...createState({ currentChapterIndex: 1 }),
      rewriteRequested: false,
      pendingIssues: [{ type: 'continuity', severity: 'error', description: 'blocked' }],
    })

    await write('story-1', { storyId: 'story-1', count: 3 })

    expect(runOneChapterMock).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('[MuseFlow] 连续写作结束：计划 3 章 / 完成 1 章')
    expect(logSpy).toHaveBeenCalledWith('  停止原因：当前章节存在严重问题')
    logSpy.mockRestore()
  })

  it('stops a multi-chapter write when the story is complete', async () => {
    const { write } = await import('../../src/cli/commands/write.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    getStateMock.mockResolvedValue(createState({ currentChapterIndex: 2 }))
    runOneChapterMock.mockResolvedValue({
      ...createState({ currentChapterIndex: 3 }),
      rewriteRequested: false,
    })

    await write('story-1', { storyId: 'story-1', count: 5 })

    expect(runOneChapterMock).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('[MuseFlow] 连续写作结束：计划 5 章 / 完成 1 章')
    expect(logSpy).toHaveBeenCalledWith('  停止原因：故事已完成')
    logSpy.mockRestore()
  })

  it('keeps single-chapter output free of a batch summary by default', async () => {
    const { write } = await import('../../src/cli/commands/write.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await write('story-1', { storyId: 'story-1' })

    expect(
      logSpy.mock.calls.some(([message]) =>
        typeof message === 'string' ? message.includes('连续写作结束') : false
      )
    ).toBe(false)
    logSpy.mockRestore()
  })

  it('keeps the mutable writing status after writing the final chapter', async () => {
    const { write } = await import('../../src/cli/commands/write.ts')
    const { printChapterReport } = await import('../../src/cli/utils/chapter-display.js')

    getStateMock.mockResolvedValue(createState({ currentChapterIndex: 2 }))
    const finalState = {
      ...createState({ currentChapterIndex: 3 }),
      chapterReport: { chapterIndex: 2 },
    }
    runOneChapterMock.mockResolvedValue(finalState)

    await write('story-1', { storyId: 'story-1' })

    expect(updateStoryRuntimeStatusMock).toHaveBeenCalledTimes(1)
    expect(updateStoryRuntimeStatusMock).toHaveBeenCalledWith('story-1', 'writing')
    expect(printChapterReport).toHaveBeenCalledWith(finalState.chapterReport, finalState)
  })

  it('does not invoke the chapter graph when the completed story is already at its boundary', async () => {
    const { write } = await import('../../src/cli/commands/write.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    getStateMock.mockResolvedValue(createState({ currentChapterIndex: 3 }))

    await write('story-1', { storyId: 'story-1' })

    expect(runOneChapterMock).not.toHaveBeenCalled()
    expect(updateStoryRuntimeStatusMock).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('[MuseFlow] 故事已完成')
    logSpy.mockRestore()
  })
})
