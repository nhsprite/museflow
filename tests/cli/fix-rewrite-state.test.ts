import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateStateMock = vi.fn().mockResolvedValue(undefined)
const getStateMock = vi.fn()
const clearPendingWritesMock = vi.fn().mockResolvedValue(undefined)
const saveChapterCheckpointMock = vi.fn().mockResolvedValue(undefined)
const pruneIntermediateCheckpointsMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../../src/graph/checkpointer.js', () => ({
  getCheckpointer: () => ({
    clearPendingWrites: clearPendingWritesMock,
    saveChapterCheckpoint: saveChapterCheckpointMock,
    pruneIntermediateCheckpoints: pruneIntermediateCheckpointsMock,
    getChapterCheckpoint: vi.fn().mockResolvedValue(null),
  }),
}))

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
  getState: getStateMock,
}))

vi.mock('../../src/graph/novel.graph.js', () => ({
  buildNovelGraph: vi.fn().mockReturnValue({
    getState: vi.fn().mockResolvedValue({
      values: {
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
        pendingIssues: [],
        rewriteApproved: false,
        rewriteRequested: false,
        isWriting: true,
        writeOneChapterOnly: true,
        lastPrintedChapter: 0,
        lastTimelineSnapshot: null,
      },
    }),
    updateState: updateStateMock,
  }),
}))

vi.mock('../../src/utils/paths.js', () => ({
  getOutputsDir: vi.fn().mockReturnValue('/tmp/books'),
  getStoryOutputDirWithTitle: vi.fn(),
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
  QualityAgent: class {
    async run() {
      return { content: 'quality check failed' }
    }
    processOutput(output: string) {
      return {
        issues: [
          {
            id: 'quality-issue',
            type: 'quality',
            severity: 'error',
            description: 'quality check failed',
          },
        ],
      }
    }
  },
  ForeshadowingAgent: class {
    async run() { return { content: '' } }
    processOutput() { return [] }
  },
  HallucinationAgent: class {
    async run() { return { content: '' } }
    processOutput() { return [] }
  },
  ConsistencyAgent: class {
    async run() { return { content: '' } }
    processOutput() { return [] }
  },
  OutlineComplianceAgent: class {
    async run() { return { content: '' } }
    processOutput() { return { issues: [], isCompliant: true } }
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

vi.mock('../../src/storage/database/dao/chapter.js', () => ({
  saveOutline: vi.fn(),
}))

vi.mock('../../src/storage/database/dao/character.js', () => ({
  saveCharacters: vi.fn(),
}))

vi.mock('../../src/storage/database/dao/world.js', () => ({
  saveWorld: vi.fn(),
}))

vi.mock('../../src/storage/database/dao/timeline.js', () => ({
  appendTimelineSnapshot: vi.fn(),
  getLatestSnapshot: vi.fn().mockReturnValue(null),
  saveForeshadowStack: vi.fn(),
  saveForeshadowAlerts: vi.fn(),
}))

vi.mock('../../src/utils/id.js', () => ({
  generateId: vi.fn().mockReturnValue('test-id'),
}))

vi.mock('../../src/cli/utils/spinner.js', () => ({
  withSpinner: vi.fn().mockImplementation(async (_msg, fn) => fn()),
  startSpinner: vi.fn(),
  stopSpinner: vi.fn(),
  stopSpinnerQuiet: vi.fn(),
}))

describe('fix command state consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateStateMock.mockResolvedValue(undefined)
  })

  it('should save currentChapterIndex when fix fails with errors', async () => {
    const { fix } = await import('../../src/cli/commands/fix.ts')

    getStateMock.mockResolvedValue({
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
          type: 'quality',
          severity: 'error',
          description: 'word count too low',
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

    await fix('story-1', {}).catch(() => {})

    const updateStateCalls = updateStateMock.mock.calls
    expect(updateStateCalls.length).toBeGreaterThan(0)

    const lastCall = updateStateCalls[updateStateCalls.length - 1]
    expect(lastCall[1]).toMatchObject({
      rewriteRequested: true,
      currentChapterIndex: 5,
    })
  })
})

describe('rewrite command state consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateStateMock.mockResolvedValue(undefined)
  })

  it('should save currentChapterIndex when rewrite fails with errors', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')

    getStateMock.mockResolvedValue({
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

    await rewrite('story-1', {}).catch(() => {})

    const updateStateCalls = updateStateMock.mock.calls
    expect(updateStateCalls.length).toBeGreaterThan(0)

    const lastCall = updateStateCalls[updateStateCalls.length - 1]
    expect(lastCall[1]).toMatchObject({
      rewriteRequested: true,
    })
  })

  it('should target current chapter when rewriteRequested is true (errors in current chapter)', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    getStateMock.mockResolvedValue({
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

    await rewrite('story-1', {}).catch(() => {})

    const targetLog = logSpy.mock.calls.find(
      call => String(call[0]).includes('目标章节:')
    )
    expect(targetLog).toBeDefined()
    expect(String(targetLog![0])).toContain('目标章节: 6/10')

    logSpy.mockRestore()
  })

  it('should target previous chapter when rewriteRequested is false (warnings in previous chapter)', async () => {
    const { rewrite } = await import('../../src/cli/commands/rewrite.ts')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    getStateMock.mockResolvedValue({
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

    await rewrite('story-1', {}).catch(() => {})

    const targetLog = logSpy.mock.calls.find(
      call => String(call[0]).includes('目标章节:')
    )
    expect(targetLog).toBeDefined()
    expect(String(targetLog![0])).toContain('目标章节: 6/10')

    logSpy.mockRestore()
  })
})
