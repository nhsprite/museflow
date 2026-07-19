import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'

const runOneChapterMock = vi.fn()
const updateStoryRuntimeStatusMock = vi.fn().mockResolvedValue(undefined)
const resolveBlockingConflictsMock = vi.fn()
const isBlockingConflictErrorMock = vi.fn()
const testTempDir = join(tmpdir(), `museflow-rewrite-feedback-${randomUUID().slice(0, 8)}`)

const initialState = {
  story: { id: 'story-1', outputDir: testTempDir },
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
  storyArc: {
    totalChapters: 10,
    acts: [
      {
        index: 1,
        startChapter: 1,
        endChapter: 10,
        title: 'Story',
        theme: '',
        function: '',
        mandatoryBeats: [],
      },
    ],
    keyBeats: [],
  },
  storyMemory: createEmptyStoryMemory(),
}
const getStateMock = vi.fn().mockResolvedValue(initialState)

vi.mock('../../src/storage/meta/stores/story.js', () => ({
  getStory: vi.fn().mockReturnValue({
    id: 'story-1',
    title: 'Test Story',
    outputDir: testTempDir,
  }),
  updateStoryStatus: vi.fn(),
  initStoryDb: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/core/runner.js', () => ({
  getState: getStateMock,
  runOneChapter: runOneChapterMock,
  updateStoryRuntimeStatus: updateStoryRuntimeStatusMock,
}))

vi.mock('../../src/cli/utils/conflict-resolver.js', () => ({
  resolveBlockingConflicts: resolveBlockingConflictsMock,
  isBlockingConflictError: isBlockingConflictErrorMock,
}))

vi.mock('../../src/cli/utils/spinner.js', () => ({
  withSpinner: vi.fn().mockImplementation(async (_msg, fn) => fn()),
}))

vi.mock('../../src/cli/utils/chapter-display.js', () => ({
  printActProgress: vi.fn(),
  printChapterOutline: vi.fn().mockReturnValue(true),
  printChapterReport: vi.fn(),
  printIssues: vi.fn(),
}))

describe('rewrite command retry feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getStateMock.mockResolvedValue(initialState)
    isBlockingConflictErrorMock.mockImplementation((err: unknown) =>
      Boolean((err as { isBlockingConflict?: boolean }).isBlockingConflict)
    )
    resolveBlockingConflictsMock.mockResolvedValue({ preserveTargetOutline: false })
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

  it('preserves current pending issues when explicitly rewriting the current chapter', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')

    await rewrite('story-1', { storyId: 'story-1', chapter: '6' })

    expect(runOneChapterMock).toHaveBeenCalledTimes(1)
    expect(runOneChapterMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        mode: 'rewrite',
        targetChapterIndex: 5,
        retryIssues: initialState.pendingIssues,
      })
    )
  })

  it('does not pass current-chapter feedback when explicitly rewriting a historical chapter', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')

    await rewrite('story-1', { storyId: 'story-1', chapter: '3' })

    expect(runOneChapterMock).toHaveBeenCalledTimes(1)
    expect(runOneChapterMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        mode: 'rewrite',
        targetChapterIndex: 2,
        retryIssues: [],
      })
    )
  })

  it('preserves adopted outline revision on the retry after blocking conflict resolution', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')

    const conflictError = Object.assign(new Error('blocking conflict'), {
      isBlockingConflict: true,
    })
    runOneChapterMock.mockRejectedValueOnce(conflictError).mockResolvedValueOnce({
      ...initialState,
      rewriteRequested: true,
      pendingIssues: [],
    })
    resolveBlockingConflictsMock.mockResolvedValueOnce({ preserveTargetOutline: true })

    await rewrite('story-1', { storyId: 'story-1', chapter: '6' })

    expect(resolveBlockingConflictsMock).toHaveBeenCalledWith('story-1', conflictError)
    expect(runOneChapterMock).toHaveBeenCalledTimes(2)
    expect(runOneChapterMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        mode: 'rewrite',
        targetChapterIndex: 5,
        preserveTargetOutline: true,
      })
    )
  })

  it('keeps the mutable writing status after a final-chapter rewrite', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')
    const { printChapterReport } = await import('../../src/cli/utils/chapter-display.js')
    const finalState = {
      ...initialState,
      currentChapterIndex: 10,
      pendingIssues: [],
      rewriteRequested: false,
      chapterReport: { chapterIndex: 9 },
    }
    runOneChapterMock.mockResolvedValueOnce(finalState)

    await rewrite('story-1', { storyId: 'story-1', chapter: '10' })

    expect(printChapterReport).toHaveBeenCalledWith(finalState.chapterReport, finalState)
    expect(updateStoryRuntimeStatusMock).toHaveBeenCalledTimes(1)
    expect(updateStoryRuntimeStatusMock).toHaveBeenCalledWith('story-1', 'writing')
  })
})
