import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createMockContext } from '../utils/mock-context.ts'

const testTempDir = join(tmpdir(), `museflow-runner-revalidation-${randomUUID().slice(0, 8)}`)
const testOutputsDir = join(
  tmpdir(),
  `museflow-runner-revalidation-outputs-${randomUUID().slice(0, 8)}`
)

const writeChapterContent = vi.fn().mockResolvedValue(undefined)
const readChapterContent = vi.fn().mockResolvedValue('chapter content')
const deleteChapterContent = vi.fn().mockResolvedValue(undefined)
const deleteStagedChapterContent = vi.fn().mockResolvedValue(undefined)
const promoteStagedChapterContent = vi.fn().mockResolvedValue(true)
const saveChapterMarker = vi.fn().mockResolvedValue(undefined)
const getChapterMarker = vi.fn().mockResolvedValue(undefined)
const pruneIntermediateCheckpoints = vi.fn().mockResolvedValue(undefined)
const clearPendingWrites = vi.fn().mockResolvedValue(undefined)
const updateLatestState = vi.fn().mockResolvedValue(undefined)
const exportMetaFromCheckpoint = vi.fn().mockResolvedValue(undefined)
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
    updateLatestState,
  }),
}))

vi.mock('../../src/storage/meta/exporter.js', () => ({
  exportMetaFromCheckpoint,
}))

const mockExistsSync = vi.fn().mockReturnValue(true)
const mockReaddirSync = vi.fn().mockReturnValue(['test-story-story-1'])
const mockReadFileSync = vi.fn().mockReturnValue(
  JSON.stringify({
    story: { id: 'story-1', outputDir: testTempDir },
  })
)

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
  deleteChapterContent,
  deleteStagedChapterContent,
  promoteStagedChapterContent,
  writeOutlineContent: vi.fn(),
  writeStoryBible: vi.fn(),
}))

vi.mock('../../src/storage/meta/stores/chapter.js', () => ({ saveOutline: vi.fn() }))
vi.mock('../../src/storage/meta/stores/character.js', () => ({ saveCharacters: vi.fn() }))
vi.mock('../../src/storage/meta/stores/world.js', () => ({ saveWorld: vi.fn() }))
vi.mock('../../src/storage/meta/stores/story.js', () => ({
  getStory: vi
    .fn()
    .mockReturnValue({ id: 'story-1', title: 'Test', outputDir: testTempDir, status: 'writing' }),
  updateStoryStatus,
  initStoryDb: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/genres/registry.js', () => ({ getGenreSkill: vi.fn().mockReturnValue(null) }))
vi.mock('../../src/utils/paths.js', () => ({
  getOutputsDir: vi.fn().mockReturnValue(testOutputsDir),
  getStoryOutputDirWithTitle: vi.fn(),
  getChapterFilePath: vi
    .fn()
    .mockImplementation(
      (outputDir: string, chapterNumber: number) => `${outputDir}/chapter_${chapterNumber}.md`
    ),
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
  processSummaryOutput: vi
    .fn()
    .mockImplementation((output: { data?: { storyState?: Record<string, unknown> } }) => {
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

  it('normalizes stale word_count retry issues to fix when the target chapter exists', async () => {
    const { normalizePendingIssuesForChapter } = await import('../../src/core/runner.js')
    const staleWordCountIssue = {
      id: 'old-word-count',
      type: 'word_count' as const,
      severity: 'error' as const,
      description: '第 1 章字数 8114 超过上限 8000 字',
      source: 'word_count' as const,
      retryStrategy: 'draft' as const,
    }

    expect(normalizePendingIssuesForChapter([staleWordCountIssue], true)).toEqual([
      expect.objectContaining({
        id: 'old-word-count',
        retryStrategy: 'fix',
      }),
    ])
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
    expect(result.pendingIssues.some((i: { severity: string }) => i.severity === 'error')).toBe(
      true
    )
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

  it('keeps the target chapter outline when preserving an adopted outline revision', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')

    await runOneChapter(
      'story-1',
      {
        mode: 'rewrite',
        targetChapterIndex: 1,
        userResponse: true,
        preserveTargetOutline: true,
      },
      createMockContext()
    )

    const invokedState = mockGraph.invoke.mock.calls[0]![0] as ReturnType<
      typeof createBaseGraphState
    >
    expect(invokedState.outline[1]).toEqual({
      number: 2,
      title: 'Chapter 2',
      description: 'Desc 2',
    })
  })

  it('keeps an existing target chapter outline during targeted rewrite by default', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')

    await runOneChapter(
      'story-1',
      {
        mode: 'rewrite',
        targetChapterIndex: 1,
        userResponse: true,
      },
      createMockContext()
    )

    const invokedState = mockGraph.invoke.mock.calls[0]![0] as ReturnType<
      typeof createBaseGraphState
    >
    expect(invokedState.outline[1]).toEqual({
      number: 2,
      title: 'Chapter 2',
      description: 'Desc 2',
    })
  })

  it('cleans target and future chapter facts from rewrite base state', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')

    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState({
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: {},
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          currentScene: '上一章结尾',
          storyTime: '上一章时间',
          canonicalFacts: [
            {
              id: 'prev',
              subject: '前章事实',
              attribute: '状态',
              value: '保留',
              establishedIn: 0,
              source: 'chapter_text',
            },
            {
              id: 'target',
              subject: '目标章事实',
              attribute: '状态',
              value: '删除',
              establishedIn: 1,
              source: 'chapter_text',
            },
            {
              id: 'future',
              subject: '未来章事实',
              attribute: '状态',
              value: '删除',
              establishedIn: 2,
              source: 'chapter_text',
            },
            {
              id: 'author',
              subject: '作者裁决',
              attribute: '状态',
              value: '保留',
              establishedIn: 2,
              source: 'author_override',
            },
          ],
          supersededFacts: [
            { subject: '前章事实', oldFact: '旧值', reason: '保留', chapterIndex: 0 },
            { subject: '目标章事实', oldFact: '旧值', reason: '删除', chapterIndex: 1 },
            { subject: '未来章事实', oldFact: '旧值', reason: '删除', chapterIndex: 2 },
          ],
        },
      }),
      config: { configurable: { checkpoint_id: 'checkpoint-123' } },
    })

    await runOneChapter(
      'story-1',
      {
        mode: 'rewrite',
        targetChapterIndex: 1,
        userResponse: true,
      },
      createMockContext()
    )

    const invokedState = mockGraph.invoke.mock.calls[0]![0] as ReturnType<
      typeof createBaseGraphState
    >
    expect(invokedState.storyState?.canonicalFacts?.map((f) => f.id)).toEqual(['prev', 'author'])
    expect(invokedState.storyState?.supersededFacts?.map((f) => f.subject)).toEqual(['前章事实'])
  })

  it('truncates storyMemory events to before the target chapter during rewrite', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')

    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState({
        storyMemory: {
          version: '1',
          lastChapterIndex: 2,
          entities: { characters: {}, items: {}, locations: {}, factions: {}, plots: {} },
          events: [
            {
              id: 'e0',
              type: 'character-location',
              chapterIndex: 0,
              source: 'chapter',
              characterId: '甲',
              locationId: '北京',
            },
            {
              id: 'e1',
              type: 'character-location',
              chapterIndex: 1,
              source: 'chapter',
              characterId: '甲',
              locationId: '上海',
            },
            {
              id: 'e2',
              type: 'character-location',
              chapterIndex: 2,
              source: 'chapter',
              characterId: '甲',
              locationId: '广州',
            },
          ],
          foreshadows: {},
          beats: {},
          tasks: {},
        },
      }),
      config: { configurable: { checkpoint_id: 'checkpoint-123' } },
    })

    await runOneChapter(
      'story-1',
      {
        mode: 'rewrite',
        targetChapterIndex: 1,
        userResponse: true,
      },
      createMockContext()
    )

    const invokedState = mockGraph.invoke.mock.calls[0]![0] as ReturnType<
      typeof createBaseGraphState
    >
    const memory = invokedState.storyMemory
    expect(memory).toBeDefined()
    expect(memory.events.map((e: { id: string }) => e.id)).toEqual(['e0'])
    expect(memory.entities.characters['甲']?.locationId).toBe('北京')
    expect(memory.lastChapterIndex).toBe(0)
  })

  it('resets target and future mandatory beat progress during rewrite', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')

    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState({
        totalChapters: 3,
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
        outline: [
          { number: 1, title: 'Chapter 1', description: 'Desc 1', verifiedBeats: ['beat-a'] },
          {
            number: 2,
            title: 'Chapter 2',
            description: 'Desc 2',
            verifiedBeats: ['beat-b'],
            verifiedBeatEvidence: [
              { beat: 'beat-b', chapterIndex: 1, quote: 'evidence', confidence: 'high' },
            ],
          },
          { number: 3, title: 'Chapter 3', description: 'Desc 3', verifiedBeats: ['beat-c'] },
        ],
        actProgress: {
          1: { consumed: ['beat-a', 'beat-b', 'beat-c'], pending: [] },
        },
      }),
      config: { configurable: { checkpoint_id: 'checkpoint-123' } },
    })

    await runOneChapter(
      'story-1',
      {
        mode: 'rewrite',
        targetChapterIndex: 1,
        userResponse: true,
      },
      createMockContext()
    )

    const invokedState = mockGraph.invoke.mock.calls[0]![0] as ReturnType<
      typeof createBaseGraphState
    >
    expect(invokedState.outline[0]?.verifiedBeats).toEqual(['beat-a'])
    expect(invokedState.outline[1]?.verifiedBeats).toBeUndefined()
    expect(invokedState.outline[1]?.verifiedBeatEvidence).toBeUndefined()
    expect(invokedState.outline[2]?.verifiedBeats).toBeUndefined()
    expect(invokedState.actProgress?.[1]).toEqual({
      consumed: ['beat-a'],
      pending: ['beat-b', 'beat-c'],
    })
  })

  it('blocks continuing when a previous act still has pending mandatory beats', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')

    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState({
        totalChapters: 5,
        currentChapterIndex: 3,
        storyArc: {
          totalChapters: 5,
          acts: [
            {
              index: 1,
              startChapter: 1,
              endChapter: 3,
              title: 'Act 1',
              theme: '',
              function: '',
              mandatoryBeats: ['beat-a', 'beat-b'],
            },
            {
              index: 2,
              startChapter: 4,
              endChapter: 5,
              title: 'Act 2',
              theme: '',
              function: '',
              mandatoryBeats: ['beat-c'],
            },
          ],
          keyBeats: [],
        },
        actProgress: {
          1: { consumed: ['beat-a'], pending: ['beat-b'] },
          2: { consumed: [], pending: ['beat-c'] },
        },
        outline: [
          { number: 1, title: 'Chapter 1', description: 'Desc 1' },
          { number: 2, title: 'Chapter 2', description: 'Desc 2' },
          { number: 3, title: 'Chapter 3', description: 'Desc 3' },
          { number: 4, title: 'Chapter 4', description: 'Desc 4' },
          { number: 5, title: 'Chapter 5', description: 'Desc 5' },
        ],
        chapters: [{}, {}, {}, null, null],
      }),
      config: { configurable: { checkpoint_id: 'checkpoint-123' } },
    })

    const result = await runOneChapter('story-1', { mode: 'draft' }, createMockContext())

    expect(mockGraph.invoke).not.toHaveBeenCalled()
    expect(result.rewriteRequested).toBe(true)
    expect(result.pendingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'act-1-pending-beats-at-boundary',
          type: 'outline_coverage',
          severity: 'error',
          retryStrategy: 'manual',
        }),
      ])
    )
    expect(updateLatestState).toHaveBeenCalledWith(
      expect.objectContaining({
        rewriteRequested: true,
        isWriting: false,
        pendingIssues: expect.arrayContaining([
          expect.objectContaining({
            id: 'act-1-pending-beats-at-boundary',
          }),
        ]),
      })
    )
  })
})
