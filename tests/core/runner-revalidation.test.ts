import { beforeEach, describe, expect, it, vi } from 'vitest'

const writeChapterContent = vi.fn().mockResolvedValue(undefined)
const readChapterContent = vi.fn().mockResolvedValue('chapter content')
const saveChapterCheckpoint = vi.fn().mockResolvedValue(undefined)
const pruneIntermediateCheckpoints = vi.fn().mockResolvedValue(undefined)
const clearPendingWrites = vi.fn().mockResolvedValue(undefined)
const appendTimelineSnapshot = vi.fn().mockReturnValue({})
const saveForeshadowStack = vi.fn()
const saveForeshadowAlerts = vi.fn()
const getForeshadowAlerts = vi.fn().mockReturnValue([])
const saveStoryState = vi.fn()
const getStoryState = vi.fn().mockReturnValue(null)
const updateStoryStatus = vi.fn()

const mockExistsSync = vi.fn().mockReturnValue(true)
const mockReaddirSync = vi.fn().mockReturnValue(['test-story-story-1'])
const mockReadFileSync = vi.fn().mockReturnValue(JSON.stringify({
  story: { id: 'story-1', outputDir: '/tmp/test' }
}))

let mockPipelineResults: Array<{
  state: Record<string, unknown>
  hasErrors: boolean
}> = []
let pipelineCallCount = 0

function createBaseGraphState(overrides: Record<string, unknown> = {}) {
  return {
    story: { id: 'story-1', title: 'Test', outputDir: '/tmp/test' },
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
  }),
  updateState: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../../src/storage/database/dao/chapter.js', () => ({ saveOutline: vi.fn() }))
vi.mock('../../src/storage/database/dao/character.js', () => ({ saveCharacters: vi.fn() }))
vi.mock('../../src/storage/database/dao/world.js', () => ({ saveWorld: vi.fn() }))
vi.mock('../../src/storage/database/dao/story.js', () => ({
  getStory: vi.fn().mockReturnValue({ id: 'story-1', title: 'Test', outputDir: '/tmp/test', status: 'writing' }),
  updateStoryStatus,
  initStoryDb: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/storage/database/dao/timeline.js', () => ({
  appendTimelineSnapshot,
  getLatestSnapshot: vi.fn().mockReturnValue(null),
  saveForeshadowStack,
  saveForeshadowAlerts,
  getForeshadowAlerts,
}))
vi.mock('../../src/storage/database/dao/story-state.js', () => ({
  saveStoryState,
  getStoryState,
  createEmptyStoryState: vi.fn().mockReturnValue({
    characterLocations: {},
    characterStatus: {},
    keyItemsLocation: {},
    activePlots: [],
    revealedSecrets: [],
    currentScene: '',
    storyTime: '',
  }),
}))
vi.mock('../../src/genres/registry.js', () => ({ getGenreSkill: vi.fn().mockReturnValue(null) }))
vi.mock('../../src/utils/paths.js', () => ({
  getOutputsDir: vi.fn().mockReturnValue('/tmp/books'),
  getStoryOutputDirWithTitle: vi.fn(),
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
      return {
        success: true,
        data: {
          sections: [{ title: 'Section 1', events: [], characters: [] }],
        },
      }
    }
  },
  QualityAgent: class {},
  ForeshadowingAgent: class {},
  HallucinationAgent: class {},
  ConsistencyAgent: class {},
  OutlineComplianceAgent: class {},
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
      return {
        success: true,
        content: 'fixed content',
        data: { modifiedParagraphs: [] },
      }
    }
  },
}))

vi.mock('../../src/core/pipeline.js', () => ({
  runChapterPipeline: vi.fn().mockImplementation((state: Record<string, unknown>) => {
    const mockResult = mockPipelineResults[pipelineCallCount]
    const result = mockResult || { state: { ...state, pendingIssues: [] }, hasErrors: false }
    pipelineCallCount++
    return Promise.resolve(result)
  }),
}))

describe('runner revalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pipelineCallCount = 0
    mockPipelineResults = []
    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState(),
    })
  })

  it('passes on first try when no warnings', async () => {
    const { continueStory } = await import('../../src/core/runner.js')

    mockPipelineResults = [
      {
        state: createBaseGraphState({ pendingIssues: [], autoFixAttempts: 0 }),
        hasErrors: false,
      },
    ]

    const result = await continueStory('story-1')

    expect(pipelineCallCount).toBe(1)
    expect(result.pendingIssues).toEqual([])
    expect(result.rewriteRequested).toBe(false)
  })

  it('re-validates after auto-fix when warnings are fixed', async () => {
    const { continueStory } = await import('../../src/core/runner.js')

    mockPipelineResults = [
      {
        state: createBaseGraphState({
          pendingIssues: [],
          autoFixAttempts: 1,
        }),
        hasErrors: false,
      },
      {
        state: createBaseGraphState({
          pendingIssues: [],
          autoFixAttempts: 0,
        }),
        hasErrors: false,
      },
    ]

    const result = await continueStory('story-1')

    expect(pipelineCallCount).toBe(2)
    expect(result.pendingIssues).toEqual([])
    expect(result.rewriteRequested).toBe(false)
  })

  it('re-validates up to 3 times when warnings persist', async () => {
    const { continueStory } = await import('../../src/core/runner.js')

    const warningState = createBaseGraphState({
      pendingIssues: [{ id: 'w1', type: 'hallucination', severity: 'warning', description: 'test' }],
      autoFixAttempts: 3,
    })

    mockPipelineResults = [
      { state: createBaseGraphState({ pendingIssues: [], autoFixAttempts: 1 }), hasErrors: false },
      { state: createBaseGraphState({ pendingIssues: [], autoFixAttempts: 2 }), hasErrors: false },
      { state: warningState, hasErrors: false },
      { state: warningState, hasErrors: false },
      { state: warningState, hasErrors: false },
      { state: warningState, hasErrors: false },
      { state: warningState, hasErrors: false },
      { state: warningState, hasErrors: false },
      { state: warningState, hasErrors: false },
      { state: warningState, hasErrors: false },
    ]

    const result = await continueStory('story-1')

    expect(pipelineCallCount).toBeGreaterThanOrEqual(3)
    expect(result.pendingIssues.some((i: { severity: string }) => i.severity === 'error')).toBe(true)
    expect(result.rewriteRequested).toBe(true)
  })

  it('stops early if re-validation finds no issues after auto-fix', async () => {
    const { continueStory } = await import('../../src/core/runner.js')

    mockPipelineResults = [
      { state: createBaseGraphState({ pendingIssues: [], autoFixAttempts: 1 }), hasErrors: false },
      { state: createBaseGraphState({ pendingIssues: [], autoFixAttempts: 0 }), hasErrors: false },
    ]

    const result = await continueStory('story-1')

    expect(pipelineCallCount).toBe(2)
    expect(result.pendingIssues).toEqual([])
  })

  it('breaks inner loop when validation finds errors', async () => {
    const { continueStory } = await import('../../src/core/runner.js')

    mockPipelineResults = [
      {
        state: createBaseGraphState({
          pendingIssues: [{ id: 'e1', type: 'quality', severity: 'error', description: 'error' }],
          autoFixAttempts: 0,
        }),
        hasErrors: true,
      },
      {
        state: createBaseGraphState({
          pendingIssues: [{ id: 'e1', type: 'quality', severity: 'error', description: 'error' }],
          autoFixAttempts: 0,
        }),
        hasErrors: true,
      },
      {
        state: createBaseGraphState({
          pendingIssues: [{ id: 'e1', type: 'quality', severity: 'error', description: 'error' }],
          autoFixAttempts: 0,
        }),
        hasErrors: true,
      },
    ]

    const result = await continueStory('story-1')

    expect(pipelineCallCount).toBe(3)
    expect(result.pendingIssues.some((i: { severity: string }) => i.severity === 'error')).toBe(true)
    expect(result.rewriteRequested).toBe(true)
  })
})
