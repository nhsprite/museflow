import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createMockContext } from '../utils/mock-context.ts'
import { applyEvents, createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import type { StoryEvent } from '../../src/types/story-memory.js'
import { buildCharacterWhitelist } from '../../src/utils/character-whitelist.js'

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
const hasStagedChapterContent = vi.fn().mockReturnValue(false)
const saveChapterMarker = vi.fn().mockResolvedValue(undefined)
const getChapterMarker = vi.fn().mockResolvedValue(undefined)
const deleteChapterMarkersFrom = vi.fn().mockResolvedValue(undefined)
const pruneIntermediateCheckpoints = vi.fn().mockResolvedValue(undefined)
const clearPendingWrites = vi.fn().mockResolvedValue(undefined)
const updateLatestState = vi.fn().mockResolvedValue(undefined)
const exportMetaFromCheckpoint = vi.fn().mockResolvedValue(undefined)
const saveChapterReport = vi.fn()
const deleteChapterReport = vi.fn()
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
    deleteChapterMarkersFrom,
    pruneIntermediateCheckpoints,
    updateLatestState,
  }),
}))

vi.mock('../../src/storage/meta/exporter.js', () => ({
  exportMetaFromCheckpoint,
}))

vi.mock('../../src/storage/meta/stores/chapter-report.js', () => ({
  saveChapterReport,
  deleteChapterReport,
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
  hasStagedChapterContent,
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
    readChapterContent.mockResolvedValue('chapter content')
    hasStagedChapterContent.mockReturnValue(false)
    getChapterMarker.mockResolvedValue(undefined)
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

  it('removes transient foreshadow equivalence failures at a new run boundary', async () => {
    const { normalizePendingIssuesForChapter } = await import('../../src/core/runner.js')
    const equivalenceFailure = {
      id: 'foreshadow-equivalence-failed',
      type: 'foreshadow_equivalence_failed' as const,
      severity: 'error' as const,
      description: 'detector unavailable during the previous run',
      source: 'foreshadowing' as const,
      retryStrategy: 'manual' as const,
    }
    const unrelatedManualIssue = {
      id: 'manual-outline-issue',
      type: 'outline_coverage' as const,
      severity: 'error' as const,
      description: 'still requires author action',
      source: 'outline_compliance' as const,
      retryStrategy: 'manual' as const,
    }

    expect(
      normalizePendingIssuesForChapter([equivalenceFailure, unrelatedManualIssue], true)
    ).toEqual([unrelatedManualIssue])
  })

  it('removes a persisted equivalence failure before reinvoking the graph for existing content', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')
    const pendingIssues = [
      {
        id: 'foreshadow-equivalence-failed',
        type: 'foreshadow_equivalence_failed' as const,
        severity: 'error' as const,
        description: 'detector unavailable during the previous run',
        source: 'foreshadowing' as const,
        retryStrategy: 'manual' as const,
      },
      {
        id: 'manual-outline-issue',
        type: 'outline_coverage' as const,
        severity: 'error' as const,
        description: 'still requires author action',
        source: 'outline_compliance' as const,
        retryStrategy: 'manual' as const,
      },
      {
        id: 'word-count-existing-content',
        type: 'word_count' as const,
        severity: 'error' as const,
        description: 'existing content is too long',
        source: 'word_count' as const,
        retryStrategy: 'draft' as const,
      },
    ]
    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState({ pendingIssues }),
      config: { configurable: { checkpoint_id: 'checkpoint-123' } },
    })

    await runOneChapter('story-1', { mode: 'rewrite', targetChapterIndex: 0 }, createMockContext())

    expect(readChapterContent).toHaveBeenCalledWith(join(testOutputsDir, 'test-story-story-1'), 1)
    const invokedState = mockGraph.invoke.mock.calls[0]![0] as ReturnType<
      typeof createBaseGraphState
    >
    expect(invokedState.pendingIssues).toEqual([
      pendingIssues[1],
      expect.objectContaining({
        id: 'word-count-existing-content',
        retryStrategy: 'fix',
      }),
    ])
  })

  it('normalizes an out-of-range must-resolve deadline to the current story boundary', async () => {
    const events: StoryEvent[] = [
      {
        id: 'evt-introduce-fs-1',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-1',
        text: '伏笔一',
        kind: 'other',
        resolutionPolicy: 'must_resolve',
        required: true,
        beatId: null,
        expectedFulfillChapter: 4,
        chapterIndex: 2,
        source: 'outline',
      },
      {
        id: 'evt-extend-fs-1',
        type: 'foreshadow-deadline-extend',
        foreshadowId: 'fs-1',
        newExpectedFulfillChapter: 66,
        chapterIndex: 57,
        source: 'outline',
      },
    ]
    const storyMemory = applyEvents(createEmptyStoryMemory(), events)
    const { normalizeRuntimeStoryMemory } = await import('../../src/core/runner.js')

    const normalized = normalizeRuntimeStoryMemory(
      createBaseGraphState({
        totalChapters: 61,
        currentChapterIndex: 59,
        story: {
          id: 'story-1',
          title: 'Test',
          outputDir: testTempDir,
          totalChapters: 61,
        },
        storyArc: {
          totalChapters: 61,
          acts: [
            {
              index: 1,
              startChapter: 1,
              endChapter: 61,
              title: '终幕',
              theme: '收束',
              function: '完成故事',
              mandatoryBeats: [],
            },
          ],
          keyBeats: [],
        },
        storyMemory,
      }) as Parameters<typeof normalizeRuntimeStoryMemory>[0]
    )

    expect(normalized.storyMemory?.foreshadows['fs-1']?.expectedFulfillChapter).toBe(61)
    expect(normalized.storyMemory?.events.at(-1)).toMatchObject({
      type: 'foreshadow-policy-set',
      foreshadowId: 'fs-1',
      resolutionPolicy: 'must_resolve',
      expectedFulfillChapter: 61,
      chapterIndex: 58,
    })
    expect(normalized.foreshadowStack.find((item) => item.id === 'fs-1')).toMatchObject({
      expectedFulfillChapter: 61,
      deadlineExtensions: 1,
    })

    const normalizedAgain = normalizeRuntimeStoryMemory(normalized)
    expect(normalizedAgain.storyMemory?.events).toHaveLength(
      normalized.storyMemory?.events.length ?? 0
    )
  })

  it('preserves valid runtime character values and object identity', async () => {
    const character = {
      id: 'character-current',
      storyId: 'story-1',
      name: 'Current Character',
      aliases: ['Current Alias'],
      isProtagonist: true,
      description: null,
      dialogueStyle: null,
      createdAt: 1,
    }
    const checkpointState = createBaseGraphState({ characters: [character] })
    const { normalizeRuntimeCharacters } = await import('../../src/core/runner.js')

    const normalized = normalizeRuntimeCharacters(
      checkpointState as Parameters<typeof normalizeRuntimeCharacters>[0]
    )

    expect(normalized).toBe(checkpointState)
    expect(normalized.characters[0]).toBe(character)
    expect(normalized.characters[0]).toMatchObject({
      aliases: ['Current Alias'],
      isProtagonist: true,
    })
  })

  it('normalizes legacy checkpoint characters when loading runtime state without mutating them', async () => {
    const legacyCharacter = {
      id: 'character-legacy',
      storyId: 'story-1',
      name: 'Legacy Character',
      description: null,
      dialogueStyle: null,
      createdAt: 1,
    }
    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState({ characters: [legacyCharacter] }),
      config: { configurable: { checkpoint_id: 'checkpoint-legacy' } },
    })
    const { getState } = await import('../../src/core/runner.js')

    const state = await getState('story-1', createMockContext())

    expect(state?.characters[0]).toMatchObject({
      aliases: [],
      isProtagonist: false,
    })
    expect(legacyCharacter).not.toHaveProperty('aliases')
    expect(legacyCharacter).not.toHaveProperty('isProtagonist')
    expect(() => buildCharacterWhitelist(state?.characters ?? [])).not.toThrow()
  })

  it('replaces malformed runtime character compatibility fields with neutral defaults', async () => {
    const malformedCharacter = {
      id: 'character-malformed',
      storyId: 'story-1',
      name: 'Malformed Character',
      aliases: ['Valid Alias', 42],
      isProtagonist: 'yes',
      description: null,
      dialogueStyle: null,
      createdAt: 1,
    }
    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState({ characters: [malformedCharacter] }),
      config: { configurable: { checkpoint_id: 'checkpoint-malformed' } },
    })
    const { getState } = await import('../../src/core/runner.js')

    const state = await getState('story-1', createMockContext())

    expect(state?.characters[0]).toMatchObject({
      aliases: [],
      isProtagonist: false,
    })
    expect(malformedCharacter.aliases).toEqual(['Valid Alias', 42])
    expect(malformedCharacter.isProtagonist).toBe('yes')
  })

  it('normalizes legacy character records from the selected rewrite checkpoint', async () => {
    const latestCharacter = {
      id: 'character-latest',
      storyId: 'story-1',
      name: 'Latest Character',
      description: null,
      dialogueStyle: null,
      createdAt: 2,
    }
    const markerCharacter = {
      id: 'character-marker',
      storyId: 'story-1',
      name: 'Marker Character',
      description: null,
      dialogueStyle: null,
      createdAt: 1,
    }
    const latestState = createBaseGraphState({
      currentChapterIndex: 2,
      characters: [latestCharacter],
    })
    const markerState = createBaseGraphState({
      currentChapterIndex: 1,
      characters: [markerCharacter],
    })
    getChapterMarker.mockResolvedValue('checkpoint-before-target')
    mockGraph.getState.mockImplementation(async (config: Record<string, any>) => ({
      values: config.configurable.checkpoint_id ? markerState : latestState,
      config: {
        configurable: {
          checkpoint_id: config.configurable.checkpoint_id ?? 'checkpoint-latest',
        },
      },
    }))
    const { runOneChapter } = await import('../../src/core/runner.js')

    await runOneChapter(
      'story-1',
      { mode: 'rewrite', targetChapterIndex: 1, userResponse: true },
      createMockContext()
    )

    const invokedState = mockGraph.invoke.mock.calls[0]![0] as Record<string, any>
    expect(invokedState.characters).toEqual([
      expect.objectContaining({
        id: 'character-marker',
        aliases: [],
        isProtagonist: false,
      }),
    ])
    expect(markerCharacter).not.toHaveProperty('aliases')
    expect(markerCharacter).not.toHaveProperty('isProtagonist')
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

  it('clears the target chapter outline when rewriting after a high-pressure mandatory-beat block', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')

    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState({
        pendingIssues: [
          {
            id: 'hp-1',
            ruleId: 'outline.mandatory-beat-unproven-high-pressure',
            type: 'beat_unproven',
            severity: 'error',
            description: '高压阻塞',
            source: 'outline_compliance',
            retryStrategy: 'draft',
          },
        ],
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
    expect(invokedState.outline[1]).toEqual({ number: 2, title: '', description: '' })
  })

  it('keeps the target chapter outline after a high-pressure block when preserveTargetOutline is set', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')

    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState({
        pendingIssues: [
          {
            id: 'hp-1',
            ruleId: 'outline.mandatory-beat-unproven-high-pressure',
            type: 'beat_unproven',
            severity: 'error',
            description: '高压阻塞',
            source: 'outline_compliance',
            retryStrategy: 'draft',
          },
        ],
      }),
      config: { configurable: { checkpoint_id: 'checkpoint-123' } },
    })

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

  it('carries a valid equivalence merge from latest state into a rewrite marker baseline', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')
    const introductionEvents: StoryEvent[] = [
      {
        id: 'intro-canonical',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-canonical',
        text: 'canonical fixture',
        expectedFulfillChapter: 3,
        resolutionPolicy: 'must_resolve',
        chapterIndex: 0,
        source: 'outline',
      },
      {
        id: 'intro-duplicate',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-duplicate',
        text: 'duplicate fixture',
        expectedFulfillChapter: 3,
        resolutionPolicy: 'must_resolve',
        chapterIndex: 0,
        source: 'outline',
      },
    ]
    const markerMemory = applyEvents(createEmptyStoryMemory(), introductionEvents)
    const latestMemory = applyEvents(markerMemory, [
      {
        id: 'merge-detected-during-rewrite',
        type: 'foreshadow-merge',
        canonicalForeshadowId: 'fs-canonical',
        duplicateForeshadowId: 'fs-duplicate',
        reason: 'same neutral fixture obligation',
        chapterIndex: 1,
        source: 'outline',
      },
    ])
    const latestAudit = {
      protocolVersion: 1 as const,
      activeCanonicalIds: ['fs-canonical'],
    }
    const latestState = createBaseGraphState({
      currentChapterIndex: 1,
      storyMemory: latestMemory,
      foreshadowEquivalenceAudit: latestAudit,
    })
    const markerState = createBaseGraphState({
      currentChapterIndex: 1,
      storyMemory: markerMemory,
    })
    getChapterMarker.mockResolvedValue('checkpoint-before-target')
    mockGraph.getState.mockImplementation(async (config: Record<string, any>) => ({
      values: config.configurable.checkpoint_id ? markerState : latestState,
      config: {
        configurable: {
          checkpoint_id: config.configurable.checkpoint_id ?? 'checkpoint-latest',
        },
      },
    }))

    await runOneChapter(
      'story-1',
      { mode: 'rewrite', targetChapterIndex: 1, userResponse: true },
      createMockContext()
    )

    const invokedState = mockGraph.invoke.mock.calls[0]![0] as Record<string, any>
    expect(invokedState.storyMemory.events.map((event: StoryEvent) => event.id)).toContain(
      'merge-detected-during-rewrite'
    )
    expect(invokedState.storyMemory.foreshadows['fs-duplicate']?.mergedInto).toBe('fs-canonical')
    expect(invokedState.foreshadowEquivalenceAudit).toEqual(latestAudit)
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
          {
            number: 1,
            title: 'Chapter 1',
            description: 'Desc 1',
            verifiedMandatoryBeatIds: ['A1-M1'],
          },
          {
            number: 2,
            title: 'Chapter 2',
            description: 'Desc 2',
            verifiedMandatoryBeatIds: ['A1-M2'],
            verifiedBeatEvidence: [
              { beat: 'beat-b', chapterIndex: 1, quote: 'evidence', confidence: 'high' },
            ],
          },
          {
            number: 3,
            title: 'Chapter 3',
            description: 'Desc 3',
            verifiedMandatoryBeatIds: ['A1-M3'],
          },
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
    expect(invokedState.outline[0]?.verifiedMandatoryBeatIds).toEqual(['A1-M1'])
    expect(invokedState.outline[1]?.verifiedMandatoryBeatIds).toBeUndefined()
    expect(invokedState.outline[1]?.verifiedBeatEvidence).toBeUndefined()
    expect(invokedState.outline[2]?.verifiedMandatoryBeatIds).toBeUndefined()
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

  it('blocks continuing when a previous act has an unproven required key beat', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')
    const storyMemory = createEmptyStoryMemory()
    storyMemory.beats['A1-B1'] = {
      id: 'A1-B1',
      description: '第一幕关键转折',
      actIndex: 1,
      deadlineAct: 1,
      required: true,
      claimedIn: null,
      provenByEventIds: [],
    }

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
              mandatoryBeats: ['beat-a'],
            },
            {
              index: 2,
              startChapter: 4,
              endChapter: 5,
              title: 'Act 2',
              theme: '',
              function: '',
              mandatoryBeats: ['beat-b'],
            },
          ],
          keyBeats: [
            {
              id: 'A1-B1',
              beat: '第一幕关键转折',
              deadlineAct: 1,
              required: true,
              coveredByMandatoryBeatId: null,
            },
          ],
        },
        storyMemory,
        actProgress: {
          1: { consumed: ['beat-a'], pending: [] },
          2: { consumed: [], pending: ['beat-b'] },
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
          id: 'past-act-1-required-beat-A1-B1',
          ruleId: 'story-completion.required-beat-unproven',
          subject: 'A1-B1',
          severity: 'error',
          retryStrategy: 'manual',
        }),
      ])
    )
    expect(updateLatestState).toHaveBeenCalledWith(
      expect.objectContaining({
        rewriteRequested: true,
        isWriting: false,
        pendingIssues: expect.arrayContaining([expect.objectContaining({ subject: 'A1-B1' })]),
      })
    )
  })

  it('audits legacy duplicate obligations and reuses the mandatory proof before past-act gating', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')
    const storyMemory = createEmptyStoryMemory()
    storyMemory.beats['A1-M1'] = {
      id: 'A1-M1',
      description: '第一幕关键转折',
      actIndex: 1,
      deadlineAct: 1,
      required: true,
      claimedIn: 2,
      provenByEventIds: ['event-proof'],
    }
    storyMemory.beats['A1-B1'] = {
      id: 'A1-B1',
      description: '第一幕关键转折',
      actIndex: 1,
      deadlineAct: 1,
      required: true,
      claimedIn: null,
      provenByEventIds: [],
    }
    const staleIssue = {
      id: 'past-act-1-required-beat-A1-B1',
      ruleId: 'story-completion.required-beat-unproven',
      type: 'outline_coverage' as const,
      severity: 'error' as const,
      subject: 'A1-B1',
      description: 'legacy blocker',
      source: 'outline_compliance' as const,
      retryStrategy: 'manual' as const,
    }

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
              mandatoryBeats: ['第一幕关键转折'],
            },
            {
              index: 2,
              startChapter: 4,
              endChapter: 5,
              title: 'Act 2',
              theme: '',
              function: '',
              mandatoryBeats: [],
            },
          ],
          keyBeats: [
            {
              id: 'A1-B1',
              beat: '第一幕关键转折',
              deadlineAct: 1,
              required: true,
            },
          ],
        },
        storyMemory,
        actProgress: {
          1: { consumed: ['第一幕关键转折'], pending: [] },
          2: { consumed: [], pending: [] },
        },
        pendingIssues: [staleIssue],
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
    const context = createMockContext()
    context.provider.chatStructured = vi.fn().mockResolvedValue({
      decisions: [{ keyBeatId: 'A1-B1', covered: true, mandatoryBeatId: 'A1-M1' }],
    })

    await runOneChapter('story-1', { mode: 'draft' }, context)

    expect(mockGraph.invoke).toHaveBeenCalledTimes(1)
    const invokedState = mockGraph.invoke.mock.calls[0]![0] as ReturnType<
      typeof createBaseGraphState
    >
    expect(invokedState.storyArc?.keyBeats[0]?.coveredByMandatoryBeatId).toBe('A1-M1')
    expect(invokedState.pendingIssues).not.toContainEqual(
      expect.objectContaining({ ruleId: 'story-completion.required-beat-unproven' })
    )
    expect(updateLatestState).toHaveBeenCalledWith({
      storyArc: expect.objectContaining({
        keyBeats: [expect.objectContaining({ coveredByMandatoryBeatId: 'A1-M1' })],
      }),
    })
  })

  it('allows continuing when previous-act required key beats have StoryMemory proof', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')
    const storyMemory = createEmptyStoryMemory()
    storyMemory.beats['A1-B1'] = {
      id: 'A1-B1',
      description: '第一幕关键转折',
      actIndex: 1,
      deadlineAct: 1,
      required: true,
      claimedIn: 2,
      provenByEventIds: ['event-proof'],
    }

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
              mandatoryBeats: [],
            },
            {
              index: 2,
              startChapter: 4,
              endChapter: 5,
              title: 'Act 2',
              theme: '',
              function: '',
              mandatoryBeats: [],
            },
          ],
          keyBeats: [
            {
              id: 'A1-B1',
              beat: '第一幕关键转折',
              deadlineAct: 1,
              required: true,
              coveredByMandatoryBeatId: null,
            },
          ],
        },
        storyMemory,
        actProgress: {
          1: { consumed: [], pending: [] },
          2: { consumed: [], pending: [] },
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

    await runOneChapter('story-1', { mode: 'draft' }, createMockContext())

    expect(mockGraph.invoke).toHaveBeenCalledTimes(1)
  })

  it('does not delete files or commit truncated state when blocked by past-act pending beats', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')

    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState({
        totalChapters: 5,
        currentChapterIndex: 4,
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
        chapters: [{}, {}, {}, {}, null],
        chapterSummaries: ['s1', 's2', 's3', 's4'],
      }),
      config: { configurable: { checkpoint_id: 'checkpoint-123' } },
    })

    const result = await runOneChapter(
      'story-1',
      { mode: 'rewrite', targetChapterIndex: 3, userResponse: true },
      createMockContext()
    )

    expect(mockGraph.invoke).not.toHaveBeenCalled()
    expect(result.rewriteRequested).toBe(true)
    expect(deleteChapterContent).not.toHaveBeenCalled()
    expect(deleteStagedChapterContent).not.toHaveBeenCalled()
    expect(deleteChapterMarkersFrom).not.toHaveBeenCalled()
    const committed = updateLatestState.mock.calls[0]![0] as Record<string, unknown>
    expect(committed).not.toHaveProperty('chapters')
    expect(committed).not.toHaveProperty('chapterSummaries')
    expect(committed).not.toHaveProperty('outline')
    expect(committed.rewriteRequested).toBe(true)
    expect(committed.isWriting).toBe(false)
  })

  it('promotes staged chapter content left behind by an interrupted commit', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')

    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState({ currentChapterIndex: 2, chapters: [{}, {}, null] }),
      config: { configurable: { checkpoint_id: 'checkpoint-123' } },
    })
    readChapterContent.mockImplementation((_dir: string, chapterNumber: number) =>
      Promise.resolve(chapterNumber === 2 ? null : 'chapter content')
    )
    hasStagedChapterContent.mockImplementation(
      (_dir: string, chapterNumber: number) => chapterNumber === 2
    )

    await runOneChapter('story-1', { mode: 'draft' }, createMockContext())

    const outputDir = join(testOutputsDir, 'test-story-story-1')
    expect(promoteStagedChapterContent).toHaveBeenCalledWith(outputDir, 2)
    const invokedState = mockGraph.invoke.mock.calls[0]![0] as Record<string, unknown>
    expect(invokedState.pendingIssues).toEqual([])
  })

  it('injects a structured draft_failure issue when a committed chapter has no content anywhere', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')

    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState({ currentChapterIndex: 2, chapters: [{}, {}, null] }),
      config: { configurable: { checkpoint_id: 'checkpoint-123' } },
    })
    readChapterContent.mockResolvedValue(null)
    hasStagedChapterContent.mockReturnValue(false)

    await runOneChapter('story-1', { mode: 'draft' }, createMockContext())

    expect(promoteStagedChapterContent).not.toHaveBeenCalledWith(testTempDir, 1)
    expect(promoteStagedChapterContent).not.toHaveBeenCalledWith(testTempDir, 2)
    const invokedState = mockGraph.invoke.mock.calls[0]![0] as Record<string, unknown>
    expect(invokedState.pendingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'chapter-1-content-missing',
          type: 'draft_failure',
          severity: 'error',
          source: 'state_reconciliation',
          retryStrategy: 'manual',
        }),
        expect.objectContaining({
          id: 'chapter-2-content-missing',
          type: 'draft_failure',
          severity: 'error',
        }),
      ])
    )
  })

  it('deletes downstream chapter files and markers at the commit boundary after a successful rewrite', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')

    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState({ currentChapterIndex: 3, chapters: [{}, {}, {}] }),
      config: { configurable: { checkpoint_id: 'checkpoint-123' } },
    })

    await runOneChapter(
      'story-1',
      { mode: 'rewrite', targetChapterIndex: 1, userResponse: true },
      createMockContext()
    )

    expect(mockGraph.invoke).toHaveBeenCalledTimes(1)
    const outputDir = join(testOutputsDir, 'test-story-story-1')
    // downstream chapter 3 is truncated; the rewritten target chapter 2 is untouched
    expect(deleteChapterContent).toHaveBeenCalledWith(outputDir, 3)
    expect(deleteChapterContent).not.toHaveBeenCalledWith(outputDir, 2)
    expect(deleteChapterReport).toHaveBeenCalledWith(outputDir, 2)
    expect(deleteChapterMarkersFrom).toHaveBeenCalledWith(2)
    // truncation happens after the graph ran and the new marker was saved
    expect(mockGraph.invoke.mock.invocationCallOrder[0]!).toBeLessThan(
      deleteChapterContent.mock.invocationCallOrder[0]!
    )
    expect(saveChapterMarker.mock.invocationCallOrder[0]!).toBeLessThan(
      deleteChapterContent.mock.invocationCallOrder[0]!
    )
  })

  it('migrates eleven legacy null-deadline required clues before graph invocation', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')
    const foreshadows = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => {
        const id = `legacy-${String(index + 1).padStart(2, '0')}`
        return [
          id,
          {
            id,
            text: id,
            kind: null,
            introducedIn: index,
            expectedFulfillChapter: null,
            fulfilledIn: null,
            required: true,
            beatId: null,
          },
        ]
      })
    )
    const storyMemory = {
      version: '1',
      lastChapterIndex: 57,
      entities: { characters: {}, items: {}, locations: {}, factions: {}, plots: {} },
      events: [],
      foreshadows,
      beats: {},
      tasks: {},
    }

    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState({
        currentChapterIndex: 57,
        totalChapters: 61,
        chapters: new Array(61).fill(null),
        storyMemory,
      }),
      config: { configurable: { checkpoint_id: 'checkpoint-legacy' } },
    })

    await runOneChapter('story-1', { mode: 'draft' }, createMockContext())

    const invokedState = mockGraph.invoke.mock.calls[0]![0] as Record<string, any>
    expect(invokedState.storyMemory.version).toBe('3')
    expect(
      Object.values(invokedState.storyMemory.foreshadows).map(
        (entry: any) => entry.resolutionPolicy
      )
    ).toEqual(new Array(11).fill('should_resolve'))
  })

  it('applies the shared rewrite cleanup (pendingTasks, foreshadow fulfillment, timeline) to the graph input', async () => {
    const { runOneChapter } = await import('../../src/core/runner.js')

    mockGraph.getState.mockResolvedValue({
      values: createBaseGraphState({
        currentChapterIndex: 3,
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: {},
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          currentScene: '',
          storyTime: '',
          pendingTasks: [
            { id: 't1', assignee: 'a', description: 'd1', createdChapter: 1, status: 'pending' },
            { id: 't2', assignee: 'a', description: 'd2', createdChapter: 3, status: 'pending' },
          ],
          canonicalFacts: [],
          supersededFacts: [],
        },
        foreshadowStack: [
          {
            id: 'f1',
            text: 'x',
            expectedFulfillChapter: 5,
            createdAt: 0,
            createdAtChapter: 1,
            fulfilledChapter: 3,
            status: 'planted',
            isExplicit: true,
            required: true,
          },
          {
            id: 'f2',
            text: 'y',
            expectedFulfillChapter: 5,
            createdAt: 0,
            createdAtChapter: 2,
            fulfilledChapter: 2,
            status: 'planted',
            isExplicit: true,
            required: true,
          },
          {
            id: 'f3',
            text: 'z',
            expectedFulfillChapter: 5,
            createdAt: 0,
            createdAtChapter: 3,
            status: 'planted',
            isExplicit: true,
            required: true,
          },
        ],
        timeline: [
          { id: 's0', storyId: 'story-1', chapterNumber: null },
          { id: 's2', storyId: 'story-1', chapterNumber: 2 },
          { id: 's3', storyId: 'story-1', chapterNumber: 3 },
        ],
      }),
      config: { configurable: { checkpoint_id: 'checkpoint-123' } },
    })

    await runOneChapter(
      'story-1',
      { mode: 'rewrite', targetChapterIndex: 2, userResponse: true },
      createMockContext()
    )

    const invokedState = mockGraph.invoke.mock.calls[0]![0] as Record<string, any>
    expect(invokedState.storyState.pendingTasks.map((t: { id: string }) => t.id)).toEqual(['t1'])
    expect(invokedState.foreshadowStack.map((f: { id: string }) => f.id)).toEqual(['f1', 'f2'])
    expect(invokedState.foreshadowStack[0].fulfilledChapter).toBeUndefined()
    expect(invokedState.foreshadowStack[1].fulfilledChapter).toBe(2)
    expect(
      invokedState.timeline.map((s: { chapterNumber: number | null }) => s.chapterNumber)
    ).toEqual([null, 2])
  })
})
