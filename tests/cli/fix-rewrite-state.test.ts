import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testTempDir = join(tmpdir(), `museflow-fix-rewrite-${randomUUID().slice(0, 8)}`)
const testOutputsDir = join(tmpdir(), `museflow-fix-rewrite-outputs-${randomUUID().slice(0, 8)}`)

const getStateMock = vi.fn()
const runOneChapterMock = vi.fn().mockResolvedValue({
  story: { id: 'story-1', outputDir: testTempDir },
  currentChapterIndex: 5,
  totalChapters: 10,
  pendingIssues: [],
  rewriteRequested: false,
})
const clearPendingWritesMock = vi.fn().mockResolvedValue(undefined)
const getStoryMock = vi.fn().mockReturnValue({
  id: 'story-1',
  title: 'Test Story',
  outputDir: testTempDir,
  status: 'writing',
})
const updateStoryStatusMock = vi.fn()
const updateStoryRuntimeStatusMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../../src/storage/checkpoint-service.js', () => ({
  createCheckpointService: () => ({
    clearPendingWrites: clearPendingWritesMock,
  }),
}))

vi.mock('../../src/storage/meta/stores/story.js', () => ({
  getStory: getStoryMock,
  updateStoryStatus: updateStoryStatusMock,
  initStoryDb: vi.fn().mockResolvedValue(undefined),
}))

const mockGraphState = {
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
  pendingIssues: [],
  rewriteApproved: false,
  rewriteRequested: false,
  isWriting: true,
  writeOneChapterOnly: true,
  lastPrintedChapter: 0,
  lastTimelineSnapshot: null,
}

vi.mock('../../src/core/runner.js', () => ({
  getState: getStateMock,
  getOutputDirFromStoryId: vi.fn().mockReturnValue(testTempDir),
  getGraph: vi.fn().mockReturnValue({
    getState: vi.fn().mockResolvedValue({ values: mockGraphState }),
  }),
  runOneChapter: runOneChapterMock,
  updateStoryRuntimeStatus: updateStoryRuntimeStatusMock,
}))

vi.mock('../../src/graph/novel.graph.js', () => ({
  buildNovelGraph: vi.fn().mockReturnValue({
    getState: vi.fn().mockResolvedValue({ values: mockGraphState }),
  }),
}))

vi.mock('../../src/utils/paths.js', () => ({
  getOutputsDir: vi.fn().mockReturnValue(testOutputsDir),
  getStoryOutputDirWithTitle: vi.fn(),
  getChapterFilePath: vi
    .fn()
    .mockImplementation(
      (outputDir: string, chapterNumber: number) => `${outputDir}/chapter_${chapterNumber}.md`
    ),
}))

vi.mock('../../src/genres/registry.js', () => ({
  getGenreSkill: vi.fn().mockReturnValue(null),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readdirSync: vi.fn().mockReturnValue(['test-story_story-1']),
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({ story: { id: 'story-1' } })),
}))

vi.mock('../../src/agents/index.js', () => ({
  WorldbuilderAgent: class {},
  CharacterAgent: class {},
  OutlineAgent: class {},
  ChapterAgent: class {
    async run() {
      return { content: 'chapter content' }
    }
    processOutput(output: string) {
      return { content: output }
    }
  },
  ChapterPlannerAgent: class {
    async run() {
      return {
        success: true,
        data: { sections: [{ title: 'Section 1' }] },
      }
    }
    processOutput(output: string) {
      return { sections: [{ title: 'Section 1' }] }
    }
  },
  ForeshadowingAgent: class {
    async run() {
      return { content: '' }
    }
    processOutput() {
      return []
    }
  },
  ConsistencyAgent: class {
    async run() {
      return { content: '' }
    }
    processOutput() {
      return []
    }
  },
  FixAgent: class {
    async run() {
      return { content: 'fixed content' }
    }
    processOutput(output: string) {
      return { content: output }
    }
  },
  SummaryAgent: class {},
  processSummaryOutput: vi.fn(),
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  writeChapterContent: vi.fn().mockResolvedValue(undefined),
  readChapterContent: vi.fn().mockResolvedValue('existing content'),
  writeOutlineContent: vi.fn(),
  writeStoryBible: vi.fn(),
  deleteChapterContent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/storage/meta/stores/chapter.js', () => ({
  saveOutline: vi.fn(),
}))

vi.mock('../../src/storage/meta/stores/character.js', () => ({
  saveCharacters: vi.fn(),
}))

vi.mock('../../src/storage/meta/stores/world.js', () => ({
  saveWorld: vi.fn(),
}))

vi.mock('../../src/utils/id.js', () => ({
  generateId: vi.fn().mockReturnValue('test-id'),
}))

vi.mock('../../src/cli/utils/spinner.js', () => ({
  withSpinner: vi.fn().mockImplementation(async (_msg, fn) => fn()),
}))

describe('rewrite command state consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getStoryMock.mockReturnValue({
      id: 'story-1',
      title: 'Test Story',
      outputDir: testTempDir,
      status: 'writing',
    })
    runOneChapterMock.mockResolvedValue({
      story: { id: 'story-1', outputDir: testTempDir },
      currentChapterIndex: 5,
      totalChapters: 10,
      pendingIssues: [],
      rewriteRequested: false,
    })
  })

  it('does not rewrite when the story is frozen', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')

    getStoryMock.mockReturnValue({
      id: 'story-1',
      title: 'Test Story',
      outputDir: testTempDir,
      status: 'freeze',
    })
    getStateMock.mockResolvedValue({
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
      currentChapterIndex: 10,
      foreshadowStack: [],
      chapterSummaries: [],
      pendingIssues: [],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: 0,
      lastTimelineSnapshot: null,
    })

    await rewrite('story-1', { storyId: 'story-1', chapter: '7' })

    expect(runOneChapterMock).not.toHaveBeenCalled()
    expect(clearPendingWritesMock).not.toHaveBeenCalled()
    expect(updateStoryRuntimeStatusMock).not.toHaveBeenCalledWith('story-1', 'writing')
  })

  it('should invoke chapter graph when rewrite fails with errors', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')

    const pendingIssues = [
      {
        id: 'issue-1',
        type: 'quality',
        severity: 'error',
        description: 'test error',
        location: 'test location',
      },
    ]

    getStateMock.mockResolvedValue({
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
      pendingIssues,
      rewriteApproved: false,
      rewriteRequested: true,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: 0,
      lastTimelineSnapshot: null,
    })

    runOneChapterMock.mockResolvedValue({
      story: { id: 'story-1', outputDir: testTempDir },
      currentChapterIndex: 5,
      totalChapters: 10,
      pendingIssues,
      rewriteRequested: true,
    })

    await rewrite('story-1', { storyId: 'story-1' }).catch(() => {})

    expect(runOneChapterMock).toHaveBeenCalledTimes(1)
    const options = runOneChapterMock.mock.calls[0]![1] as Record<string, unknown>
    expect(options.userResponse).toBe(true)
    expect(options.targetChapterIndex).toBe(5)
  })

  it('should target current chapter when rewriteRequested is true (errors in current chapter)', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    getStateMock.mockResolvedValue({
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
          type: 'quality',
          severity: 'error',
          description: 'test error',
          location: 'test location',
        },
      ],
      rewriteApproved: false,
      rewriteRequested: true,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: 0,
      lastTimelineSnapshot: null,
    })

    await rewrite('story-1', { storyId: 'story-1' }).catch(() => {})

    const targetLog = logSpy.mock.calls.find((call) => String(call[0]).includes('目标章节:'))
    expect(targetLog).toBeDefined()
    expect(String(targetLog![0])).toContain('目标章节: 6/10')

    logSpy.mockRestore()
  })

  it('should target previous chapter when rewriteRequested is false (warnings in previous chapter)', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    getStateMock.mockResolvedValue({
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
      currentChapterIndex: 6,
      foreshadowStack: [],
      chapterSummaries: [],
      pendingIssues: [
        {
          id: 'issue-1',
          type: 'quality',
          severity: 'warning',
          description: 'test warning',
          location: 'test location',
        },
      ],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: 0,
      lastTimelineSnapshot: null,
    })

    await rewrite('story-1', { storyId: 'story-1' }).catch(() => {})

    const targetLog = logSpy.mock.calls.find((call) => String(call[0]).includes('目标章节:'))
    expect(targetLog).toBeDefined()
    expect(String(targetLog![0])).toContain('目标章节: 6/10')

    logSpy.mockRestore()
  })

  it('should target current chapter when errors exist even if rewriteRequested is false', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    getStateMock.mockResolvedValue({
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
          severity: 'error',
          description: 'test error',
          location: 'test location',
        },
      ],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: 0,
      lastTimelineSnapshot: null,
    })

    await rewrite('story-1', { storyId: 'story-1' }).catch(() => {})

    const targetLog = logSpy.mock.calls.find((call) => String(call[0]).includes('目标章节:'))
    expect(targetLog).toBeDefined()
    expect(String(targetLog![0])).toContain('目标章节: 6/10')

    logSpy.mockRestore()
  })

  it('should pass currentChapterIndex to graph when errors exist but rewriteRequested is false', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')

    getStateMock.mockResolvedValue({
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
          severity: 'error',
          description: 'test error',
          location: 'test location',
        },
      ],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: 0,
      lastTimelineSnapshot: null,
    })

    await rewrite('story-1', { storyId: 'story-1' }).catch(() => {})

    expect(runOneChapterMock).toHaveBeenCalledTimes(1)
    const options = runOneChapterMock.mock.calls[0]![1] as Record<string, unknown>
    expect(options.targetChapterIndex).toBe(5)
    expect(options.userResponse).toBe(true)
  })

  it('should honor --chapter flag regardless of pending issues state', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    getStateMock.mockResolvedValue({
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
          severity: 'error',
          description: 'test error',
          location: 'test location',
        },
      ],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: 0,
      lastTimelineSnapshot: null,
    })

    await rewrite('story-1', { storyId: 'story-1', chapter: '3' }).catch(() => {})

    const targetLog = logSpy.mock.calls.find((call) => String(call[0]).includes('目标章节:'))
    expect(targetLog).toBeDefined()
    expect(String(targetLog![0])).toContain('目标章节: 3/10')

    expect(runOneChapterMock).toHaveBeenCalledTimes(1)
    const options = runOneChapterMock.mock.calls[0]![1] as Record<string, unknown>
    expect(options.targetChapterIndex).toBe(2)

    logSpy.mockRestore()
  })

  it('prints rewrite progress from the target chapter base state', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    getStateMock.mockResolvedValue({
      story: { id: 'story-1', outputDir: testTempDir },
      idea: 'test',
      genre: 'default',
      totalChapters: 3,
      world: null,
      characters: [],
      storyArc: {
        totalChapters: 3,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 3,
            title: 'Act',
            theme: '',
            function: '',
            mandatoryBeats: ['beat-a', 'beat-b', 'beat-c'],
          },
        ],
        keyBeats: [
          { id: 'kb-a', beat: 'beat-a', deadlineAct: 1, required: true },
          { id: 'kb-b', beat: 'beat-b', deadlineAct: 1, required: true },
          { id: 'kb-c', beat: 'beat-c', deadlineAct: 1, required: true },
        ],
      },
      actProgress: {
        1: { consumed: ['beat-a', 'beat-b', 'beat-c'], pending: [] },
      },
      outline: [
        {
          number: 1,
          title: 'Chapter 1',
          description: 'Description 1',
          verifiedMandatoryBeatIds: ['A1-M1'],
        },
        {
          number: 2,
          title: 'Chapter 2',
          description: 'Description 2',
          verifiedMandatoryBeatIds: ['A1-M2'],
        },
        {
          number: 3,
          title: 'Chapter 3',
          description: 'Description 3',
          verifiedMandatoryBeatIds: ['A1-M3'],
        },
      ],
      chapters: Array(3).fill(null),
      currentChapterIndex: 2,
      foreshadowStack: [],
      chapterSummaries: [],
      pendingIssues: [],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: 0,
      lastTimelineSnapshot: null,
    })

    await rewrite('story-1', { storyId: 'story-1', chapter: '2' }).catch(() => {})

    expect(logSpy).toHaveBeenCalledWith('  节拍进度: 1/3 已消费，剩余 2')
    expect(logSpy).toHaveBeenCalledWith('    1. beat-b')
    expect(logSpy).toHaveBeenCalledWith('    2. beat-c')

    logSpy.mockRestore()
  })

  it('should target current chapter when mixed errors and warnings exist with rewriteRequested false', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    getStateMock.mockResolvedValue({
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
      currentChapterIndex: 7,
      foreshadowStack: [],
      chapterSummaries: [],
      pendingIssues: [
        {
          id: 'issue-1',
          type: 'quality',
          severity: 'warning',
          description: 'test warning',
          location: 'test location',
        },
        {
          id: 'issue-2',
          type: 'consistency',
          severity: 'error',
          description: 'test error',
          location: 'test location',
        },
      ],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: 0,
      lastTimelineSnapshot: null,
    })

    await rewrite('story-1', { storyId: 'story-1' }).catch(() => {})

    const targetLog = logSpy.mock.calls.find((call) => String(call[0]).includes('目标章节:'))
    expect(targetLog).toBeDefined()
    expect(String(targetLog![0])).toContain('目标章节: 8/10')

    logSpy.mockRestore()
  })

  it('should not go below chapter 1 when targeting previous chapter with warnings', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    getStateMock.mockResolvedValue({
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
      currentChapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
      pendingIssues: [
        {
          id: 'issue-1',
          type: 'quality',
          severity: 'warning',
          description: 'test warning',
          location: 'test location',
        },
      ],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: 0,
      lastTimelineSnapshot: null,
    })

    await rewrite('story-1', { storyId: 'story-1' }).catch(() => {})

    const targetLog = logSpy.mock.calls.find((call) => String(call[0]).includes('目标章节:'))
    expect(targetLog).toBeDefined()
    expect(String(targetLog![0])).toContain('目标章节: 1/10')

    logSpy.mockRestore()
  })
})
