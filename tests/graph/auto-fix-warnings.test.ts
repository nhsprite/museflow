import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReducedGraphState } from '../../src/graph/state.js'

const mockWriteChapterContent = vi.fn().mockResolvedValue(undefined)
const mockReadChapterContent = vi.fn().mockResolvedValue('test chapter content')

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  writeChapterContent: mockWriteChapterContent,
  readChapterContent: mockReadChapterContent,
  writeOutlineContent: vi.fn(),
  writeStoryBible: vi.fn(),
  deleteChapterContent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/agents/index.js', () => ({
  WorldbuilderAgent: class {},
  CharacterAgent: class {},
  OutlineAgent: class {},
  ChapterAgent: class {},
  ChapterPlannerAgent: class {},
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
        content: 'fixed paragraph 1\n\nfixed paragraph 2\n\nfixed paragraph 3',
        data: {
          modifiedParagraphs: [
            { index: 0, content: 'fixed paragraph 1' },
          ],
        },
      }
    }
  },
}))

vi.mock('../../src/storage/meta/stores/story-state.js', () => ({
  getStoryState: vi.fn().mockReturnValue(null),
  saveStoryState: vi.fn(),
  createEmptyStoryState: vi.fn().mockReturnValue({
    characterLocations: {},
    characterStatus: {},
    keyItemsLocation: {},
    keyItemsState: {},
    activePlots: [],
    revealedSecrets: [],
    pendingTasks: [],
    currentScene: '',
    storyTime: '',
  }),
}))

vi.mock('../../src/storage/meta/stores/timeline.js', () => ({
  appendTimelineSnapshot: vi.fn(),
  getLatestSnapshot: vi.fn().mockReturnValue(null),
  saveForeshadowStack: vi.fn(),
  saveForeshadowAlerts: vi.fn(),
  getForeshadowAlerts: vi.fn().mockReturnValue([]),
}))

vi.mock('../../src/utils/id.js', () => ({
  generateId: vi.fn().mockReturnValue('test-id'),
}))

vi.mock('../../src/graph/checkpointer.js', () => ({
  getCheckpointer: vi.fn().mockReturnValue({
    saveChapterCheckpoint: vi.fn().mockResolvedValue(undefined),
    pruneIntermediateCheckpoints: vi.fn().mockResolvedValue(undefined),
    clearPendingWrites: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('../../src/genres/registry.js', () => ({
  getGenreSkill: vi.fn().mockReturnValue(null),
}))

describe('auto_fix_warnings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadChapterContent.mockResolvedValue('paragraph 1\n\nparagraph 2\n\nparagraph 3')
  })

  it('calls fix_chapter when warnings exist and returns cleared pendingIssues', async () => {
    const { auto_fix_warnings } = await import('../../src/graph/nodes.js')

    const state: ReducedGraphState = {
      story: { id: 'story-1', outputDir: '/tmp/test', title: 'Test' },
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
      chapters: Array.from({ length: 10 }, (_, i) => ({
        id: `chapter-${i}`,
        storyId: 'story-1',
        number: i + 1,
        title: null,
        outline: null,
        summary: null,
        foreshadows: null,
        status: 'drafting',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      currentChapterIndex: 2,
      foreshadowStack: [],
      chapterSummaries: [],
      pendingIssues: [
        {
          id: 'warning-1',
          type: 'consistency',
          severity: 'warning',
          description: '描写冗余',
          location: '第一段',
        },
      ],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: -1,
      lastTimelineSnapshot: null,
      chapterPlan: null,
      storyState: null,
      autoFixAttempts: 0,
    }

    const result = await auto_fix_warnings(state)

    expect(mockReadChapterContent).toHaveBeenCalled()
    expect(mockWriteChapterContent).toHaveBeenCalled()
    expect(result.pendingIssues).toEqual([])
    expect(result.chapters).toBeDefined()
    expect(result.chapters?.[2]).toBeDefined()
    expect(result.autoFixAttempts).toBe(1)
  })

  it('preserves abstract quality warnings instead of trying to fix them', async () => {
    const { auto_fix_warnings } = await import('../../src/graph/nodes.js')

    const state: ReducedGraphState = {
      story: { id: 'story-1', outputDir: '/tmp/test', title: 'Test' },
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      world: null,
      characters: [],
      outline: [],
      chapters: [],
      currentChapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
      pendingIssues: [
        {
          id: 'warning-1',
          type: 'quality',
          severity: 'warning',
          description: '情感层次略显单一',
        },
      ],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: -1,
      lastTimelineSnapshot: null,
      chapterPlan: null,
      storyState: null,
      autoFixAttempts: 0,
    }

    const result = await auto_fix_warnings(state)

    expect(mockReadChapterContent).not.toHaveBeenCalled()
    expect(result.pendingIssues).toEqual(state.pendingIssues)
    expect(result.autoFixAttempts).toBe(0)
  })

  it('returns empty object when errors exist (does not fix warnings)', async () => {
    const { auto_fix_warnings } = await import('../../src/graph/nodes.js')

    const state: ReducedGraphState = {
      story: { id: 'story-1', outputDir: '/tmp/test', title: 'Test' },
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      world: null,
      characters: [],
      outline: [],
      chapters: [],
      currentChapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
      pendingIssues: [
        {
          id: 'error-1',
          type: 'quality',
          severity: 'error',
          description: '严重错误',
        },
        {
          id: 'warning-1',
          type: 'quality',
          severity: 'warning',
          description: '描写冗余',
        },
      ],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: -1,
      lastTimelineSnapshot: null,
      chapterPlan: null,
      storyState: null,
      autoFixAttempts: 0,
    }

    const result = await auto_fix_warnings(state)

    expect(mockReadChapterContent).not.toHaveBeenCalled()
    expect(result).toEqual({ autoFixAttempts: 0 })
  })

  it('returns empty object when no warnings exist', async () => {
    const { auto_fix_warnings } = await import('../../src/graph/nodes.js')

    const state: ReducedGraphState = {
      story: { id: 'story-1', outputDir: '/tmp/test', title: 'Test' },
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      world: null,
      characters: [],
      outline: [],
      chapters: [],
      currentChapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
      pendingIssues: [
        {
          id: 'info-1',
          type: 'quality',
          severity: 'info',
          description: '建议',
        },
      ],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: -1,
      lastTimelineSnapshot: null,
      chapterPlan: null,
      storyState: null,
      autoFixAttempts: 0,
    }

    const result = await auto_fix_warnings(state)

    expect(mockReadChapterContent).not.toHaveBeenCalled()
    expect(result).toEqual({ autoFixAttempts: 0 })
  })

  it('does not fix when max attempts reached (3) and preserves pendingIssues', async () => {
    const { auto_fix_warnings } = await import('../../src/graph/nodes.js')

    const state: ReducedGraphState = {
      story: { id: 'story-1', outputDir: '/tmp/test', title: 'Test' },
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      world: null,
      characters: [],
      outline: [],
      chapters: [],
      currentChapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
      pendingIssues: [
        {
          id: 'warning-1',
          type: 'quality',
          severity: 'warning',
          description: '描写冗余',
        },
      ],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: -1,
      lastTimelineSnapshot: null,
      chapterPlan: null,
      storyState: null,
      autoFixAttempts: 3,
    }

    const result = await auto_fix_warnings(state)

    expect(mockReadChapterContent).not.toHaveBeenCalled()
    expect(result.autoFixAttempts).toBe(3)
    expect(result.pendingIssues).toEqual(state.pendingIssues)
  })
})
