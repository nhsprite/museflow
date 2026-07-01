import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createMockContext } from '../utils/mock-context.ts'

const testTempDir = join(tmpdir(), `museflow-runner-revalidation-${randomUUID().slice(0, 8)}`)
const testOutputsDir = join(tmpdir(), `museflow-runner-revalidation-outputs-${randomUUID().slice(0, 8)}`)

const writeChapterContent = vi.fn().mockResolvedValue(undefined)
const readChapterContent = vi.fn().mockResolvedValue('chapter content')
const saveChapterMarker = vi.fn().mockResolvedValue(undefined)
const getChapterMarker = vi.fn().mockResolvedValue(undefined)
const pruneIntermediateCheckpoints = vi.fn().mockResolvedValue(undefined)
const clearPendingWrites = vi.fn().mockResolvedValue(undefined)
const updateStoryStatus = vi.fn()
const chapterPlannerRun = vi.fn().mockResolvedValue({
  success: true,
  data: {
    sections: [{ title: 'Section 1', events: [], characters: [] }],
  },
})

vi.mock('../../src/storage/checkpoint-service.js', () => ({
  createCheckpointService: vi.fn().mockReturnValue({
    clearPendingWrites,
    saveChapterMarker,
    getChapterMarker,
    pruneIntermediateCheckpoints,
  }),
}))

const mockExistsSync = vi.fn().mockReturnValue(true)
const mockReaddirSync = vi.fn().mockReturnValue(['test-story-story-1'])
const mockReadFileSync = vi.fn().mockReturnValue(JSON.stringify({
  story: { id: 'story-1', outputDir: testTempDir }
}))

function createBaseGraphState(overrides: Record<string, unknown> = {}) {
  return {
    story: { id: 'story-1', title: 'Test', outputDir: testTempDir },
    idea: 'test idea',
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
    chapterPlan: null,
    storyState: null,
    autoFixAttempts: 0,
    ...overrides,
  }
}

const mockGraph = {
  getState: vi.fn().mockResolvedValue({
    values: createBaseGraphState(),
    config: { configurable: { checkpoint_id: 'checkpoint-123' } },
  }),
  updateState: vi.fn().mockResolvedValue(undefined),
  invoke: vi.fn().mockResolvedValue(createBaseGraphState({ currentChapterIndex: 1 })),
}

vi.mock(import('node:fs'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
    readFileSync: mockReadFileSync,
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  }
})

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  writeChapterContent,
  readChapterContent,
  writeOutlineContent: vi.fn(),
  writeStoryBible: vi.fn(),
}))

vi.mock('../../src/storage/meta/stores/chapter.js', () => ({ saveOutline: vi.fn() }))
vi.mock('../../src/storage/meta/stores/character.js', () => ({ saveCharacters: vi.fn() }))
vi.mock('../../src/storage/meta/stores/world.js', () => ({ saveWorld: vi.fn() }))
vi.mock('../../src/storage/meta/stores/story.js', () => ({
  getStory: vi.fn().mockReturnValue({ id: 'story-1', title: 'Test', outputDir: testTempDir, status: 'writing' }),
  updateStoryStatus,
  initStoryDb: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/genres/registry.js', () => ({ getGenreSkill: vi.fn().mockReturnValue(null) }))
vi.mock('../../src/utils/paths.js', () => ({
  getOutputsDir: vi.fn().mockReturnValue(testOutputsDir),
  getStoryOutputDirWithTitle: vi.fn(),
  getChapterFilePath: vi.fn().mockImplementation((outputDir: string, chapterNumber: number) => `${outputDir}/chapter_${chapterNumber}.md`),
}))
vi.mock('../../src/utils/id.js', () => ({ generateId: vi.fn().mockReturnValue('test-id') }))

vi.mock('../../src/graph/novel.graph.js', () => ({
  buildNovelGraph: vi.fn().mockReturnValue(mockGraph),
}))

vi.mock('../../src/agents/index.js', () => ({
  WorldbuilderAgent: class {},
  CharacterAgent: class {},
  OutlineAgent: class {},
  ChapterAgent: class {
    async run() {
      return {
        success: true,
        content: 'test chapter content',
      }
    }
  },
  ChapterPlannerAgent: class {
    async run() {
      return chapterPlannerRun()
    }
  },
  ForeshadowingAgent: class {},
  ConsistencyAgent: class {},
  SummaryAgent: class {
    async run() {
      return {
        success: true,
        data: {
          characters: [],
          characterFacts: [],
          keyEvents: [],
          locations: [],
          keyItems: [],
          activePlots: [],
          mood: '',
          storyState: {
            characterLocations: {},
            characterStatus: {},
            keyItemsLocation: {},
            activePlots: [],
            revealedSecrets: [],
            currentScene: 'test scene',
            storyTime: 'test time',
          },
        },
      }
    }
  },
  processSummaryOutput: vi.fn().mockImplementation((output: { data?: { storyState?: Record<string, unknown> } }) => {
    if (!output.data) return null
    return {
      summary: JSON.stringify(output.data),
      storyState: output.data.storyState,
    }
  }),
  FixAgent: class {
    async run() {
      const fixedContent = '# 第1章 测试章节\n\n' + '测试正文内容。'.repeat(600)
      return {
        success: true,
        content: `=== FIXED_CHAPTER ===\n${fixedContent}\n=== END_FIXED_CHAPTER ===`,
        data: { modifiedParagraphs: [] },
      }
    }
  },
}))


describe('runner revalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState(),
      config: { configurable: { checkpoint_id: 'checkpoint-123' } },
    })
    mockGraph.invoke.mockResolvedValue(createBaseGraphState({ currentChapterIndex: 1 }))
  })

  it('invokes the chapter-writing graph and returns its final state', async () => {
    const { continueStory } = await import('../../src/core/runner.js')

    mockGraph.invoke.mockResolvedValue(
      createBaseGraphState({ currentChapterIndex: 1, pendingIssues: [] })
    )

    const result = await continueStory('story-1', undefined, undefined, {}, createMockContext())

    expect(mockGraph.invoke).toHaveBeenCalledTimes(1)
    const invokedState = mockGraph.invoke.mock.calls[0]![0] as Record<string, unknown>
    expect(invokedState.isWriting).toBe(true)
    expect(invokedState.writeOneChapterOnly).toBe(true)
    expect(result.currentChapterIndex).toBe(1)
    expect(result.pendingIssues).toEqual([])
    expect(result.rewriteRequested).toBe(false)
  })

  it('propagates rewriteRequested when the graph returns broken state', async () => {
    const { continueStory } = await import('../../src/core/runner.js')

    mockGraph.invoke.mockResolvedValue(
      createBaseGraphState({
        currentChapterIndex: 0,
        rewriteRequested: true,
        pendingIssues: [{ id: 'e1', type: 'quality', severity: 'error', description: 'error' }],
      })
    )

    const result = await continueStory('story-1', undefined, undefined, {}, createMockContext())

    expect(mockGraph.invoke).toHaveBeenCalledTimes(1)
    expect(result.rewriteRequested).toBe(true)
    expect(result.pendingIssues.some((i: { severity: string }) => i.severity === 'error')).toBe(true)
  })

  it('passes userResponse as rewriteApproved to the graph', async () => {
    const { continueStory } = await import('../../src/core/runner.js')

    mockGraph.invoke.mockResolvedValue(
      createBaseGraphState({ currentChapterIndex: 1, pendingIssues: [] })
    )

    await continueStory('story-1', true, undefined, {}, createMockContext())

    const invokedState = mockGraph.invoke.mock.calls[0]![0] as Record<string, unknown>
    expect(invokedState.rewriteApproved).toBe(true)
  })

  it('uses the supplied currentChapterIndex as the target chapter', async () => {
    const { continueStory } = await import('../../src/core/runner.js')

    mockGraph.invoke.mockResolvedValue(
      createBaseGraphState({ currentChapterIndex: 2, pendingIssues: [] })
    )

    await continueStory('story-1', undefined, 2, {}, createMockContext())

    const invokedState = mockGraph.invoke.mock.calls[0]![0] as Record<string, unknown>
    expect(invokedState.currentChapterIndex).toBe(2)
  })

  it('treats supplied currentChapterIndex as rewrite mode by default', async () => {
    const { continueStory } = await import('../../src/core/runner.js')

    mockGraph.invoke.mockResolvedValue(
      createBaseGraphState({ currentChapterIndex: 2, pendingIssues: [] })
    )

    await continueStory('story-1', undefined, 2, {}, createMockContext())

    const invokedState = mockGraph.invoke.mock.calls[0]![0] as Record<string, unknown>
    expect(invokedState.currentChapterIndex).toBe(2)
  })

  it('allows targeting a chapter without rewrite mode via options', async () => {
    const { continueStory } = await import('../../src/core/runner.js')

    mockGraph.invoke.mockResolvedValue(
      createBaseGraphState({ currentChapterIndex: 2, pendingIssues: [] })
    )

    await continueStory('story-1', undefined, 2, { isRewrite: false }, createMockContext())

    const invokedState = mockGraph.invoke.mock.calls[0]![0] as Record<string, unknown>
    expect(invokedState.currentChapterIndex).toBe(2)
    // non-rewrite mode leaves storyState untouched
    expect(invokedState.storyState).toBeNull()
  })

  it('saves chapter checkpoint after a chapter is finalized', async () => {
    const { continueStory } = await import('../../src/core/runner.js')

    mockGraph.invoke.mockResolvedValue(
      createBaseGraphState({ currentChapterIndex: 1, pendingIssues: [] })
    )

    await continueStory('story-1', undefined, undefined, {}, createMockContext())

    expect(saveChapterMarker).toHaveBeenCalledTimes(1)
    expect(saveChapterMarker).toHaveBeenCalledWith(1, 'checkpoint-123')
  })

  it('does not save chapter checkpoint when rewrite is requested', async () => {
    const { continueStory } = await import('../../src/core/runner.js')

    mockGraph.invoke.mockResolvedValue(
      createBaseGraphState({
        currentChapterIndex: 0,
        rewriteRequested: true,
        pendingIssues: [{ id: 'e1', type: 'quality', severity: 'error', description: 'error' }],
      })
    )

    await continueStory('story-1', undefined, undefined, {}, createMockContext())

    expect(saveChapterMarker).not.toHaveBeenCalled()
  })
})
