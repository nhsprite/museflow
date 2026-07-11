import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { finalizeChapter } from '@/graph/services/finalization/chapter.js'
import { getSummaryAgent } from '@/graph/agent-factory.js'
import { createEmptyStoryState } from '@/storage/meta/stores/story-state.js'
import type { ReducedGraphState } from '@/graph/state.js'
import type { ModelProvider } from '@/model/provider.js'
import type { ChapterSession } from '@/core/chapter-generation/routing/types.js'
import type { ForeshadowMemory, StoryEvent, StoryMemory } from '@/types/story-memory.js'
import type { ChapterPlan } from '@/agents/types.js'
import { proposeActBoundaryAdjustments, applyActBoundaryAdjustment } from '@/utils/story-arc.js'
import { logger } from '@/utils/logger.js'
import { createEmptyStoryMemory } from '@/story-memory/projector.js'

const { loadConfigMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn(() => ({
    model: { provider: 'openai' as const, model: 'gpt-4o' },
    autoAdjustActBoundaries: false,
  })),
}))

function createBaseSummaryAgent() {
  return {
    run: vi.fn().mockResolvedValue({
      success: true,
      data: {
        chapterSummary: '主角离开家乡，踏上旅途。',
        storyEvents: [
          {
            id: 'evt-1',
            type: 'plot-advance',
            plotId: 'plot-1',
            beatId: 'beat-1',
            chapterIndex: 0,
            source: 'chapter',
            evidence: { paragraphIndex: 1 },
          },
          {
            id: 'evt-2',
            type: 'task-create',
            taskId: 'task-1',
            description: '主角需要找到失散的同伴。',
            chapterIndex: 0,
            source: 'chapter',
            evidence: { paragraphIndex: 1 },
          },
        ],
      },
    }),
  }
}

vi.mock('@/config/store.js', () => ({
  loadConfig: loadConfigMock,
}))

vi.mock('@/graph/agent-factory.js', () => ({
  getSummaryAgent: vi.fn().mockReturnValue(createBaseSummaryAgent()),
}))

vi.mock('@/graph/checkpointer.js', () => ({
  getCheckpointer: vi.fn().mockReturnValue({
    getTuple: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue({} as never),
    list: vi.fn().mockResolvedValue([]),
    deleteThread: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/utils/story-arc.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/story-arc.js')>()
  return {
    ...actual,
    proposeActBoundaryAdjustments: vi.fn().mockReturnValue([]),
    applyActBoundaryAdjustment: vi.fn().mockReturnValue({
      storyArc: null,
      applied: false,
    }),
  }
})

function createMockProvider(): ModelProvider {
  return { chat: vi.fn().mockResolvedValue(''), chatStructured: vi.fn().mockResolvedValue({}) }
}

function buildSession(overrides: Partial<ChapterSession> = {}): ChapterSession {
  return {
    chapterIndex: 0,
    rewriteAttempts: 0,
    errorRewriteAttempts: 0,
    autoFixAttempts: 0,
    previousIssues: [],
    previousRawErrorCount: 0,
    routingDecision: 'finalize_chapter',
    forceStructuralRewrite: false,
    rewriteApproved: false,
    issueFingerprintHistory: [],
    ...overrides,
  }
}

function buildChapterPlan(overrides: Partial<ChapterPlan> = {}): ChapterPlan {
  return {
    chapterIndex: 0,
    sections: [],
    timeline: [],
    outlineCheck: [],
    expectedEvents: [],
    claimedBeatIds: [],
    fulfilledForeshadowIds: [],
    introducedForeshadowIds: [],
    resolvedTaskIds: [],
    createdTaskIds: [],
    ...overrides,
  }
}

function makeForeshadowMemory(
  id: string,
  overrides: Partial<ForeshadowMemory> = {}
): ForeshadowMemory {
  return {
    id,
    text: `${id} text`,
    kind: null,
    introducedIn: 0,
    expectedFulfillChapter: 2,
    fulfilledIn: null,
    required: true,
    beatId: null,
    ...overrides,
  }
}

function makeStoryMemory(
  foreshadows: Record<string, ForeshadowMemory> = {},
  events: StoryEvent[] = []
): StoryMemory {
  return {
    version: '1',
    lastChapterIndex: 0,
    entities: { characters: {}, items: {}, locations: {}, factions: {}, plots: {} },
    events,
    foreshadows,
    beats: {},
    tasks: {},
  }
}

function buildState(
  outputDir: string,
  overrides: Partial<ReducedGraphState> & { session?: Partial<ChapterSession> } = {}
): ReducedGraphState {
  const { session: sessionOverrides, ...rest } = overrides
  const base: ReducedGraphState = {
    story: {
      id: 'test-story',
      title: 'Test',
      outputDir,
      genre: 'default',
      totalChapters: 3,
      status: 'writing',
      provider: 'openai',
      idea: 'test idea',
      createdAt: 0,
      updatedAt: 0,
    },
    idea: 'test idea',
    genre: 'default',
    totalChapters: 3,
    currentChapterIndex: 0,
    chapters: [
      {
        id: 'ch-1',
        storyId: 'test-story',
        number: 1,
        title: '启程',
        outline: '主角离开家乡。',
        summary: null,
        foreshadows: null,
        status: 'drafting',
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    chapterSummaries: [],
    foreshadowStack: [],
    outline: [
      { number: 1, title: '启程', description: '主角离开家乡。' },
      { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
      { number: 3, title: '脱困', description: '主角脱困。' },
    ],
    storyArc: {
      totalChapters: 3,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 3,
          title: '启程',
          theme: '出发',
          function: '建立动机',
          mandatoryBeats: ['主角离开家乡'],
        },
      ],
      keyBeats: [{ id: 'beat-1', beat: '主角离开家乡', deadlineAct: 1, required: true }],
    },
    actProgress: { 1: { consumed: [], pending: ['主角离开家乡'] } },
    characters: [
      {
        id: 'char-1',
        storyId: 'test-story',
        name: '主角',
        description: '主角',
        dialogueStyle: null,
        createdAt: 0,
      },
    ],
    world: null,
    storyState: createEmptyStoryState(),
    pendingIssues: [],
    verifiedConstraints: [],
    chapterReport: null,
    blockingReport: null,
    authorDecisions: {},
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: true,
    lastPrintedChapter: -1,
    lastTimelineSnapshot: null,
    chapterPlan: null,
    chapterTimeAnchor: undefined,
    autoFixAttempts: 0,
    session: buildSession(sessionOverrides),
    storyMemory: null,
    ...rest,
  } as unknown as ReducedGraphState
  return base
}

describe('finalizeChapter', () => {
  let tmpDir: string

  beforeEach(async () => {
    loadConfigMock.mockReturnValue({
      model: { provider: 'openai' as const, model: 'gpt-4o' },
      autoAdjustActBoundaries: false,
    })
    vi.mocked(getSummaryAgent).mockReturnValue(
      createBaseSummaryAgent() as unknown as ReturnType<typeof getSummaryAgent>
    )
    vi.mocked(proposeActBoundaryAdjustments).mockReturnValue([])
    vi.mocked(applyActBoundaryAdjustment).mockReturnValue({
      storyArc: null,
      applied: false,
    })

    tmpDir = path.join(process.cwd(), 'tests', 'tmp', `finalize-chapter-${Date.now()}`)
    await fs.mkdir(path.join(tmpDir, 'chapters'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'chapters', 'chapter_1.md'),
      '# 第一章 启程\n\n主角告别了故乡，踏上了未知的旅途。',
      'utf-8'
    )
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('applies summary story events to StoryMemory and returns updated state', async () => {
    const state = buildState(tmpDir)
    const provider = createMockProvider()

    const result = await finalizeChapter(state, provider)

    expect(result.storyMemory).not.toBeNull()
    expect(result.storyMemory?.events).toHaveLength(2)
    expect(result.storyState?.pendingTasks[0]).toMatchObject({
      id: 'task-1',
      description: '主角需要找到失散的同伴。',
      createdChapter: 1,
      status: 'pending',
    })
    expect(result.foreshadowStack).toEqual([])
    expect(result.verifiedConstraints?.some((c) => c.text.includes('未完成任务'))).toBe(true)
    expect(result.currentChapterIndex).toBe(1)
  })

  it('does not apply summary candidate events without paragraph evidence', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: {
          chapterSummary: '主角离开家乡，踏上旅途。',
          storyEvents: [
            {
              id: 'evt-no-evidence',
              type: 'plot-advance',
              plotId: 'plot-1',
              beatId: 'beat-1',
              chapterIndex: 0,
              source: 'chapter',
            },
          ],
        },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)

    const state = buildState(tmpDir)
    const provider = createMockProvider()

    const result = await finalizeChapter(state, provider)

    expect(result.storyMemory?.events.some((event) => event.id === 'evt-no-evidence')).toBe(false)
    expect(result.storyMemory?.beats['beat-1']?.provenByEventIds).toEqual([])
    expect(result.actProgress?.[1]?.consumed).not.toContain('主角离开家乡')
  })

  it('passes only current-chapter planned foreshadows from StoryMemory to SummaryAgent', async () => {
    const run = vi.fn().mockResolvedValue({
      success: true,
      data: { chapterSummary: '摘要', storyEvents: [] },
    })
    vi.mocked(getSummaryAgent).mockReturnValue({
      run,
    } as unknown as ReturnType<typeof getSummaryAgent>)
    const state = buildState(tmpDir, {
      chapterPlan: buildChapterPlan({ fulfilledForeshadowIds: ['fs-planned'] }),
      storyMemory: {
        version: '1',
        lastChapterIndex: 0,
        entities: { characters: {}, items: {}, locations: {}, factions: {}, plots: {} },
        events: [],
        foreshadows: {
          'fs-planned': {
            id: 'fs-planned',
            text: '本章计划回收的线索',
            kind: 'object_foreshadow',
            introducedIn: 0,
            expectedFulfillChapter: 1,
            fulfilledIn: null,
            required: true,
            beatId: null,
          },
          'fs-unplanned': {
            id: 'fs-unplanned',
            text: '仍然活跃但本章未计划回收的线索',
            kind: 'dialogue_hint',
            introducedIn: 0,
            expectedFulfillChapter: 3,
            fulfilledIn: null,
            required: true,
            beatId: null,
          },
        },
        beats: {},
        tasks: {},
      },
    })

    await finalizeChapter(state, createMockProvider())

    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[0].plannedForeshadowFulfillments).toEqual([
      { id: 'fs-planned', text: '本章计划回收的线索' },
    ])
  })

  it('passes no planned foreshadows when chapterPlan belongs to another chapter', async () => {
    const run = vi.fn().mockResolvedValue({
      success: true,
      data: { chapterSummary: '摘要', storyEvents: [] },
    })
    vi.mocked(getSummaryAgent).mockReturnValue({
      run,
    } as unknown as ReturnType<typeof getSummaryAgent>)
    const state = buildState(tmpDir, {
      chapterPlan: buildChapterPlan({
        chapterIndex: 1,
        fulfilledForeshadowIds: ['fs-stale'],
      }),
      storyMemory: {
        version: '1',
        lastChapterIndex: 0,
        entities: { characters: {}, items: {}, locations: {}, factions: {}, plots: {} },
        events: [],
        foreshadows: {
          'fs-stale': {
            id: 'fs-stale',
            text: '其他章节的计划目标',
            kind: null,
            introducedIn: 0,
            expectedFulfillChapter: 2,
            fulfilledIn: null,
            required: true,
            beatId: null,
          },
        },
        beats: {},
        tasks: {},
      },
    })

    await finalizeChapter(state, createMockProvider())

    expect(run.mock.calls[0]?.[0].plannedForeshadowFulfillments).toEqual([])
  })

  it('applies an evidence-backed planned foreshadow fulfillment from SummaryAgent', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: {
          chapterSummary: '摘要',
          storyEvents: [
            {
              id: 'evt-fulfill',
              type: 'foreshadow-fulfill',
              foreshadowId: 'fs-planned',
              chapterIndex: 0,
              source: 'chapter',
              evidence: { paragraphIndex: 1 },
            },
          ],
        },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)
    const state = buildState(tmpDir, {
      chapterPlan: buildChapterPlan({ fulfilledForeshadowIds: ['fs-planned'] }),
      storyMemory: {
        version: '1',
        lastChapterIndex: 0,
        entities: { characters: {}, items: {}, locations: {}, factions: {}, plots: {} },
        events: [],
        foreshadows: {
          'fs-planned': {
            id: 'fs-planned',
            text: '本章计划回收的线索',
            kind: null,
            introducedIn: 0,
            expectedFulfillChapter: 1,
            fulfilledIn: null,
            required: true,
            beatId: null,
          },
        },
        beats: {},
        tasks: {},
      },
    })

    const result = await finalizeChapter(state, createMockProvider())

    expect(result.storyMemory?.foreshadows['fs-planned']?.fulfilledIn).toBe(0)
    expect(result.foreshadowStack?.[0]?.fulfilledChapter).toBe(1)
  })

  it('filters a planned foreshadow fulfillment with invalid paragraph evidence', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: {
          chapterSummary: '摘要',
          storyEvents: [
            {
              id: 'evt-fulfill-no-evidence',
              type: 'foreshadow-fulfill',
              foreshadowId: 'fs-planned',
              chapterIndex: 0,
              source: 'chapter',
              evidence: { paragraphIndex: 2 },
            },
          ],
        },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)
    const state = buildState(tmpDir, {
      chapterPlan: buildChapterPlan({ fulfilledForeshadowIds: ['fs-planned'] }),
      storyMemory: {
        version: '1',
        lastChapterIndex: 0,
        entities: { characters: {}, items: {}, locations: {}, factions: {}, plots: {} },
        events: [],
        foreshadows: {
          'fs-planned': {
            id: 'fs-planned',
            text: '本章计划回收的线索',
            kind: null,
            introducedIn: 0,
            expectedFulfillChapter: 1,
            fulfilledIn: null,
            required: true,
            beatId: null,
          },
        },
        beats: {},
        tasks: {},
      },
    })

    const result = await finalizeChapter(state, createMockProvider())

    expect(result.storyMemory?.foreshadows['fs-planned']?.fulfilledIn).toBeNull()
    expect(result.storyMemory?.events).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'evt-fulfill-no-evidence' })])
    )
  })

  it('rejects an evidence-backed unplanned foreshadow fulfillment from SummaryAgent', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: {
          chapterSummary: '摘要',
          storyEvents: [
            {
              id: 'evt-unplanned-fulfill',
              type: 'foreshadow-fulfill',
              foreshadowId: 'fs-unplanned',
              chapterIndex: 0,
              source: 'chapter',
              evidence: { paragraphIndex: 1 },
            },
          ],
        },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)
    const state = buildState(tmpDir, {
      chapterPlan: buildChapterPlan({ fulfilledForeshadowIds: ['fs-planned'] }),
      storyMemory: makeStoryMemory({
        'fs-planned': makeForeshadowMemory('fs-planned'),
        'fs-unplanned': makeForeshadowMemory('fs-unplanned'),
      }),
    })

    const result = await finalizeChapter(state, createMockProvider())

    expect(result.storyMemory?.foreshadows['fs-unplanned']?.fulfilledIn).toBeNull()
    expect(result.storyMemory?.events.some((event) => event.id === 'evt-unplanned-fulfill')).toBe(
      false
    )
  })

  it('rejects SummaryAgent events for a different chapter', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: {
          chapterSummary: '摘要',
          storyEvents: [
            {
              id: 'evt-wrong-chapter',
              type: 'task-create',
              taskId: 'task-wrong-chapter',
              description: 'wrong chapter',
              chapterIndex: 1,
              source: 'chapter',
              evidence: { paragraphIndex: 1 },
            },
          ],
        },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)

    const result = await finalizeChapter(buildState(tmpDir), createMockProvider())

    expect(result.storyMemory?.events.some((event) => event.id === 'evt-wrong-chapter')).toBe(false)
    expect(result.storyMemory?.tasks['task-wrong-chapter']).toBeUndefined()
  })

  it('rejects SummaryAgent events that do not use chapter source', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: {
          chapterSummary: '摘要',
          storyEvents: [
            {
              id: 'evt-wrong-source',
              type: 'task-create',
              taskId: 'task-wrong-source',
              description: 'wrong source',
              chapterIndex: 0,
              source: 'outline',
              evidence: { paragraphIndex: 1 },
            },
          ],
        },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)

    const result = await finalizeChapter(buildState(tmpDir), createMockProvider())

    expect(result.storyMemory?.events.some((event) => event.id === 'evt-wrong-source')).toBe(false)
    expect(result.storyMemory?.tasks['task-wrong-source']).toBeUndefined()
  })

  it('does not present or reapply an already-fulfilled stale plan target', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'chapters', 'chapter_2.md'),
      '# 第二章 遇敌\n\n主角继续前行。',
      'utf-8'
    )
    const run = vi.fn().mockResolvedValue({
      success: true,
      data: {
        chapterSummary: '摘要',
        storyEvents: [
          {
            id: 'evt-stale-reapply',
            type: 'foreshadow-fulfill',
            foreshadowId: 'fs-stale',
            chapterIndex: 1,
            source: 'chapter',
            evidence: { paragraphIndex: 1 },
          },
        ],
      },
    })
    vi.mocked(getSummaryAgent).mockReturnValue({ run } as unknown as ReturnType<
      typeof getSummaryAgent
    >)
    const historicalEvents: StoryEvent[] = [
      {
        id: 'evt-stale-introduce',
        type: 'foreshadow-introduce',
        foreshadowId: 'fs-stale',
        text: '已在前章回收的线索',
        expectedFulfillChapter: 2,
        chapterIndex: 0,
        source: 'chapter',
        evidence: { paragraphIndex: 1 },
      },
      {
        id: 'evt-stale-fulfilled',
        type: 'foreshadow-fulfill',
        foreshadowId: 'fs-stale',
        chapterIndex: 0,
        source: 'chapter',
        evidence: { paragraphIndex: 1 },
      },
    ]
    const state = buildState(tmpDir, {
      currentChapterIndex: 1,
      chapters: [
        null,
        {
          id: 'ch-2',
          storyId: 'test-story',
          number: 2,
          title: '遇敌',
          outline: '主角遭遇敌人。',
          summary: null,
          foreshadows: null,
          status: 'drafting',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      chapterPlan: buildChapterPlan({
        chapterIndex: 1,
        fulfilledForeshadowIds: ['fs-stale'],
      }),
      storyMemory: makeStoryMemory(
        {
          'fs-stale': makeForeshadowMemory('fs-stale', {
            text: '已在前章回收的线索',
            fulfilledIn: 0,
          }),
        },
        historicalEvents
      ),
    })

    const result = await finalizeChapter(state, createMockProvider())

    expect(run.mock.calls[0]?.[0].plannedForeshadowFulfillments).toEqual([])
    expect(result.storyMemory?.events.some((event) => event.id === 'evt-stale-reapply')).toBe(false)
    expect(result.storyMemory?.foreshadows['fs-stale']?.fulfilledIn).toBe(0)
  })

  it('does not present fulfilled targets or duplicate event IDs already emitted by the draft', async () => {
    const run = vi.fn().mockResolvedValue({
      success: true,
      data: {
        chapterSummary: '摘要',
        storyEvents: [
          {
            id: 'evt-draft-fulfill',
            type: 'foreshadow-fulfill',
            foreshadowId: 'fs-planned',
            chapterIndex: 0,
            source: 'chapter',
            evidence: { paragraphIndex: 1 },
          },
          {
            id: 'evt-draft-task',
            type: 'task-create',
            taskId: 'task-summary-duplicate',
            description: 'summary duplicate',
            chapterIndex: 0,
            source: 'chapter',
            evidence: { paragraphIndex: 1 },
          },
        ],
      },
    })
    vi.mocked(getSummaryAgent).mockReturnValue({ run } as unknown as ReturnType<
      typeof getSummaryAgent
    >)
    const draftFulfillment: StoryEvent = {
      id: 'evt-draft-fulfill',
      type: 'foreshadow-fulfill',
      foreshadowId: 'fs-planned',
      chapterIndex: 0,
      source: 'chapter',
      evidence: { paragraphIndex: 1 },
    }
    const draftTask: StoryEvent = {
      id: 'evt-draft-task',
      type: 'task-create',
      taskId: 'task-draft-original',
      description: 'draft original',
      chapterIndex: 0,
      source: 'chapter',
      evidence: { paragraphIndex: 1 },
    }
    const state = buildState(tmpDir, {
      chapterPlan: buildChapterPlan({ fulfilledForeshadowIds: ['fs-planned'] }),
      storyMemory: makeStoryMemory({
        'fs-planned': makeForeshadowMemory('fs-planned'),
      }),
      draftChapterEvents: [draftFulfillment, draftTask],
    })

    const result = await finalizeChapter(state, createMockProvider())

    expect(run.mock.calls[0]?.[0].plannedForeshadowFulfillments).toEqual([])
    expect(
      result.storyMemory?.events.filter((event) => event.id === 'evt-draft-fulfill')
    ).toHaveLength(1)
    expect(
      result.storyMemory?.events.filter((event) => event.id === 'evt-draft-task')
    ).toHaveLength(1)
    expect(result.storyMemory?.tasks['task-draft-original']).toBeDefined()
    expect(result.storyMemory?.tasks['task-summary-duplicate']).toBeUndefined()
    expect(result.storyMemory?.foreshadows['fs-planned']?.fulfilledIn).toBe(0)
  })

  it('stores summary chapter handoff on storyState for the next chapter contract', async () => {
    const chapterHandoff = {
      chapterNumber: 1,
      endScene: '村口',
      endTime: '黄昏',
      charactersPresent: ['char-1'],
      lastAction: '主角回头看了一眼故乡',
      openQuestions: ['旅途方向仍未确定'],
      requiredNextOpening: '下一章应从主角离开村口后的路上承接',
    }
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: {
          chapterSummary: '主角离开家乡，踏上旅途。',
          chapterHandoff,
          storyEvents: [],
        },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)

    const state = buildState(tmpDir)
    const provider = createMockProvider()

    const result = await finalizeChapter(state, provider)

    expect(result.storyState?.chapterHandoff).toEqual(chapterHandoff)
  })

  it('uses StoryMemory as the foreshadow source of truth during finalization', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: {
          chapterSummary: '主角离开家乡，踏上旅途。',
          storyEvents: [],
        },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)

    const state = buildState(tmpDir, {
      storyMemory: {
        version: '1',
        lastChapterIndex: 0,
        entities: { characters: {}, items: {}, locations: {}, factions: {}, plots: {} },
        events: [],
        foreshadows: {},
        beats: {},
        tasks: {},
      },
      foreshadowStack: [
        {
          id: 'semantic-only',
          text: '语义检测提出但未进入结构化事件账本的候选伏笔',
          expectedFulfillChapter: 3,
          createdAt: 1,
          createdAtChapter: 1,
          status: 'planted',
          isExplicit: false,
          required: true,
        },
      ],
    })
    const provider = createMockProvider()

    const result = await finalizeChapter(state, provider)

    expect(result.foreshadowStack).toEqual([])
  })

  it('projects StoryMemory chapter indexes to one-based foreshadow item chapters', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: { chapterSummary: '摘要', storyEvents: [] },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)
    const state = buildState(tmpDir, {
      storyMemory: {
        version: '1',
        lastChapterIndex: 0,
        entities: { characters: {}, items: {}, locations: {}, factions: {}, plots: {} },
        events: [],
        foreshadows: {
          'fs-1': {
            id: 'fs-1',
            text: '已回收伏笔',
            kind: null,
            introducedIn: 0,
            expectedFulfillChapter: 3,
            fulfilledIn: 0,
            required: true,
            beatId: null,
          },
        },
        beats: {},
        tasks: {},
      },
    })

    const result = await finalizeChapter(state, createMockProvider())

    expect(result.foreshadowStack?.[0]?.createdAtChapter).toBe(1)
    expect(result.foreshadowStack?.[0]?.fulfilledChapter).toBe(1)
  })

  it('consumes mandatory beats from draftChapterEvents without prose-based judgment', async () => {
    const state = buildState(tmpDir, {
      draftChapterEvents: [
        {
          id: 'evt-draft-1',
          type: 'plot-advance',
          plotId: 'act-1',
          beatId: 'beat-1',
          chapterIndex: 0,
          source: 'chapter',
          evidence: { paragraphIndex: 1 },
        } as StoryEvent,
      ],
    })
    const provider = createMockProvider()

    const result = await finalizeChapter(state, provider)

    expect(result.rewriteRequested).toBeFalsy()
    expect(result.currentChapterIndex).toBe(1)
    expect(result.storyMemory?.beats['beat-1']?.provenByEventIds).toContain('evt-draft-1')
    expect(result.outline?.[0]?.verifiedBeats).toContain('主角离开家乡')
    expect(result.actProgress?.[1]?.consumed).toContain('主角离开家乡')
    expect(result.actProgress?.[1]?.pending).not.toContain('主角离开家乡')
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('does not consume claimed beats through prose-based coverage fallback', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: {
          chapterSummary: '本章只推进了第二与第四个结构节拍。',
          storyEvents: [],
        },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)
    await fs.writeFile(
      path.join(tmpDir, 'chapters', 'chapter_3.md'),
      '# 第三章 推进\n\n本章集中推进第二与第四个结构节拍。',
      'utf-8'
    )

    const mandatoryBeats = ['beat-a', 'beat-b', 'beat-c', 'beat-d', 'beat-e']
    const state = buildState(tmpDir, {
      currentChapterIndex: 2,
      totalChapters: 6,
      story: {
        ...buildState(tmpDir).story,
        totalChapters: 6,
      },
      outline: [
        { number: 1, title: '起', description: 'beat-a', verifiedBeats: ['beat-a'] },
        { number: 2, title: '承', description: '过渡' },
        {
          number: 3,
          title: '推进',
          description: '推进第二与第四个结构节拍。',
          claimedBeats: ['beat-b', 'beat-d'],
        },
        { number: 4, title: '转', description: '' },
        { number: 5, title: '合', description: '' },
        { number: 6, title: '余', description: '' },
      ],
      chapters: [
        null,
        null,
        {
          id: 'ch-3',
          storyId: 'test-story',
          number: 3,
          title: '推进',
          outline: '推进第二与第四个结构节拍。',
          summary: null,
          foreshadows: null,
          status: 'drafting',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      storyArc: {
        totalChapters: 6,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 6,
            title: 'Act',
            theme: '',
            function: '',
            mandatoryBeats,
          },
        ],
        keyBeats: mandatoryBeats.map((beat, index) => ({
          id: `beat-${index + 1}`,
          beat,
          deadlineAct: 1,
          required: true,
        })),
      },
      actProgress: {
        1: { consumed: ['beat-a'], pending: ['beat-b', 'beat-c', 'beat-d', 'beat-e'] },
      },
      storyMemory: null,
    })
    const provider: ModelProvider = {
      chat: vi.fn().mockResolvedValue(''),
      chatStructured: vi.fn().mockResolvedValue({ coveredBeats: mandatoryBeats }),
    }

    const result = await finalizeChapter(state, provider)

    expect(provider.chatStructured).not.toHaveBeenCalled()
    expect(result.outline?.[2]?.verifiedBeats).toBeUndefined()
    expect(result.actProgress?.[1]?.consumed).toEqual(['beat-a'])
    expect(result.actProgress?.[1]?.pending).toEqual(['beat-b', 'beat-c', 'beat-d', 'beat-e'])
  })

  it('ignores plot-advance events with beat IDs outside the story arc', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: {
          chapterSummary: '主角仍未真正离开家乡。',
          storyEvents: [],
        },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)

    const state = buildState(tmpDir, {
      draftChapterEvents: [
        {
          id: 'evt-invalid',
          type: 'plot-advance',
          plotId: 'act-1',
          beatId: 'beat-1（补充说明）',
          chapterIndex: 0,
          source: 'chapter',
          evidence: { paragraphIndex: 1 },
        } as StoryEvent,
      ],
    })
    const provider = createMockProvider()

    const result = await finalizeChapter(state, provider)

    expect(result.storyMemory?.events.some((event) => event.id === 'evt-invalid')).toBe(false)
    expect(result.storyMemory?.beats['beat-1（补充说明）']).toBeUndefined()
    expect(result.actProgress?.[1]?.consumed).not.toContain('主角离开家乡')
  })

  it('replaces stale unverified-beat warnings instead of stacking duplicates', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: {
          chapterSummary: '主角还在家里收拾行李。',
          storyEvents: [],
        },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)

    const state = buildState(tmpDir, {
      outline: [
        {
          number: 1,
          title: '启程',
          description: '主角离开家乡。',
          claimedBeats: ['主角离开家乡'],
        },
        { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
        { number: 3, title: '脱困', description: '主角脱困。' },
      ],
      pendingIssues: [
        {
          id: 'unverified-beat-1-0',
          type: 'outline_coverage',
          severity: 'warning',
          description:
            '本章大纲声称推进 mandatory beat「主角离开家乡」，但正文未验证到该 beat 的发生。',
          suggestion: '请在后续章节中确保该 beat 被明确确立。',
        },
      ],
    })
    const provider = createMockProvider()

    const result = await finalizeChapter(state, provider)

    const warnings = result.pendingIssues?.filter(
      (i) => i.id === 'unverified-beat-1-0' && i.type === 'outline_coverage'
    )
    expect(warnings).toHaveLength(1)
  })

  it('requests rewrite when an act-end claimed mandatory beat is not verified', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: {
          chapterSummary: '主角仍未真正离开家乡。',
          storyEvents: [],
        },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)
    await fs.writeFile(
      path.join(tmpDir, 'chapters', 'chapter_3.md'),
      '# 第三章 脱困\n\n主角仍在原地迟疑，旅途尚未开始。',
      'utf-8'
    )

    const state = buildState(tmpDir, {
      currentChapterIndex: 2,
      outline: [
        { number: 1, title: '启程', description: '主角准备离开家乡。' },
        { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
        {
          number: 3,
          title: '脱困',
          description: '主角应当离开家乡。',
          claimedBeats: ['主角离开家乡'],
          claimedBeatIds: ['beat-1'],
        },
      ],
      chapters: [
        null,
        null,
        {
          id: 'ch-3',
          storyId: 'test-story',
          number: 3,
          title: '脱困',
          outline: '主角应当离开家乡。',
          summary: null,
          foreshadows: null,
          status: 'drafting',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      storyMemory: null,
    })
    const provider = createMockProvider()

    const result = await finalizeChapter(state, provider)

    expect(result.rewriteRequested).toBe(true)
    expect(result.currentChapterIndex).toBeUndefined()
    expect(result.pendingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'unverified-beat-id-beat-1',
          type: 'outline_coverage',
          severity: 'error',
          subject: 'beat-1',
        }),
      ])
    )
  })

  it('keeps text-only claimed beats as warnings before the act boundary', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: {
          chapterSummary: '主角仍未真正离开家乡。',
          storyEvents: [],
        },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)
    await fs.writeFile(
      path.join(tmpDir, 'chapters', 'chapter_2.md'),
      '# 第二章 遇敌\n\n主角仍在原地迟疑，旅途尚未开始。',
      'utf-8'
    )

    const state = buildState(tmpDir, {
      currentChapterIndex: 1,
      outline: [
        { number: 1, title: '启程', description: '主角准备离开家乡。' },
        {
          number: 2,
          title: '遇敌',
          description: '主角应当离开家乡。',
          claimedBeats: ['主角离开家乡'],
          claimedBeatIds: [],
        },
        { number: 3, title: '脱困', description: '主角脱困。' },
      ],
      chapters: [
        null,
        {
          id: 'ch-2',
          storyId: 'test-story',
          number: 2,
          title: '遇敌',
          outline: '主角应当离开家乡。',
          summary: null,
          foreshadows: null,
          status: 'drafting',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      storyMemory: null,
    })
    const provider = createMockProvider()

    const result = await finalizeChapter(state, provider)

    expect(result.rewriteRequested).toBeFalsy()
    expect(result.currentChapterIndex).toBe(2)
    expect(result.pendingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'unverified-beat-1-0',
          type: 'outline_coverage',
          severity: 'warning',
        }),
      ])
    )
  })

  it('does not advance beyond an act boundary while mandatory beats are still pending', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: {
          chapterSummary: '主角仍未真正离开家乡。',
          storyEvents: [],
        },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)
    await fs.writeFile(
      path.join(tmpDir, 'chapters', 'chapter_3.md'),
      '# 第三章 脱困\n\n主角仍在原地迟疑，旅途尚未开始。',
      'utf-8'
    )

    const state = buildState(tmpDir, {
      currentChapterIndex: 2,
      outline: [
        { number: 1, title: '启程', description: '主角准备离开家乡。' },
        { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
        { number: 3, title: '脱困', description: '主角应当离开家乡。' },
      ],
      chapters: [
        null,
        null,
        {
          id: 'ch-3',
          storyId: 'test-story',
          number: 3,
          title: '脱困',
          outline: '主角应当离开家乡。',
          summary: null,
          foreshadows: null,
          status: 'drafting',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      storyMemory: null,
    })
    const provider = createMockProvider()

    const result = await finalizeChapter(state, provider)

    expect(result.rewriteRequested).toBe(true)
    expect(result.currentChapterIndex).toBeUndefined()
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
  })

  it('blocks an unresolved required foreshadow due by the act-end chapter', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue(emptySummaryAgent())
    await writeChapter(tmpDir, 3, '幕末正文。')
    const state = boundaryState(tmpDir, {
      foreshadows: {
        'fs-due': testMemoryForeshadow('fs-due', 'beat-1', true, 3),
      },
      beats: {
        'beat-1': testMemoryBeat('beat-1', 1),
      },
    })

    const result = await finalizeChapter(state, createMockProvider())

    expect(result.rewriteRequested).toBe(true)
    expect(result.pendingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'foreshadow_boundary_unresolved',
          severity: 'error',
          subject: 'fs-due',
        }),
      ])
    )
  })

  it('does not infer an act deadline from beat association', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue(emptySummaryAgent())
    await writeChapter(tmpDir, 3, '幕末正文。')
    const state = boundaryState(tmpDir, {
      foreshadows: {
        'fs-future': testMemoryForeshadow('fs-future', 'beat-1', true, 5),
        'fs-unscheduled': testMemoryForeshadow('fs-unscheduled', 'beat-1', true, null),
        'fs-optional': testMemoryForeshadow('fs-optional', 'beat-1', false, 3),
      },
      beats: {
        'beat-1': testMemoryBeat('beat-1', 1),
      },
    })

    const result = await finalizeChapter(state, createMockProvider())

    expect(result.rewriteRequested).toBeFalsy()
    expect(result.currentChapterIndex).toBe(3)
  })

  it('blocks every unresolved required foreshadow at story end', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue(emptySummaryAgent())
    await writeChapter(tmpDir, 3, '全书结尾正文。')
    const base = boundaryState(tmpDir, {
      foreshadows: {
        'fs-unbound': testMemoryForeshadow('fs-unbound', null, true, null),
      },
      beats: {},
    })
    const state = buildState(tmpDir, {
      ...base,
      totalChapters: 3,
      story: { ...base.story, totalChapters: 3 },
      storyArc: base.storyArc ? { ...base.storyArc, totalChapters: 3 } : null,
    })

    const result = await finalizeChapter(state, createMockProvider())

    expect(result.rewriteRequested).toBe(true)
    expect(result.pendingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'foreshadow_boundary_unresolved',
          subject: 'fs-unbound',
        }),
      ])
    )
  })

  it('rejects an invalid foreshadow deadline emitted by the summary agent', async () => {
    vi.mocked(getSummaryAgent).mockReturnValue({
      run: vi.fn().mockResolvedValue({
        success: true,
        data: {
          chapterSummary: '摘要',
          storyEvents: [
            {
              id: 'evt-invalid-deadline',
              type: 'foreshadow-introduce',
              foreshadowId: 'fs-invalid',
              expectedFulfillChapter: 0,
              chapterIndex: 0,
              source: 'chapter',
              evidence: { paragraphIndex: 1 },
            },
          ],
        },
      }),
    } as unknown as ReturnType<typeof getSummaryAgent>)

    const result = await finalizeChapter(buildState(tmpDir), createMockProvider())

    expect(result.rewriteRequested).toBe(true)
    expect(result.storyMemory?.foreshadows['fs-invalid']).toBeUndefined()
    expect(result.pendingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'foreshadow_invalid_deadline',
          subject: 'fs-invalid',
        }),
      ])
    )
  })

  it('does not advance chapter index and requests rewrite when act boundary adjustment requires manual resolution', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    vi.mocked(proposeActBoundaryAdjustments).mockReturnValueOnce([
      {
        actIndex: 1,
        proposedEndChapter: 5,
        reason: 'test proposal',
      },
    ])
    vi.mocked(applyActBoundaryAdjustment).mockReturnValueOnce({
      storyArc: null,
      applied: false,
      requiresManualResolution: true,
      reason: '已达到自动延长上限',
    })
    loadConfigMock.mockReturnValue({
      model: { provider: 'openai' as const, model: 'gpt-4o' },
      autoAdjustActBoundaries: true,
    })

    const state = buildState(tmpDir)
    const provider = createMockProvider()

    const result = await finalizeChapter(state, provider)

    expect(result.currentChapterIndex).toBeUndefined()
    expect(result.rewriteRequested).toBe(true)
    expect(result.pendingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'outline_coverage',
          severity: 'error',
          retryStrategy: 'manual',
        }),
      ])
    )
    expect(result.chapterReport).not.toBeNull()
    expect(result.chapterReport?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'outline_coverage',
          severity: 'error',
        }),
      ])
    )
    expect(warnSpy).toHaveBeenCalledWith(
      '[MuseFlow] 建议运行：museflow adjust-act test-story --act 1 --end-chapter 5'
    )
  })
})

function emptySummaryAgent(): ReturnType<typeof getSummaryAgent> {
  return {
    run: vi.fn().mockResolvedValue({
      success: true,
      data: { chapterSummary: '摘要', storyEvents: [] },
    }),
  } as unknown as ReturnType<typeof getSummaryAgent>
}

async function writeChapter(outputDir: string, number: number, content: string): Promise<void> {
  await fs.writeFile(
    path.join(outputDir, 'chapters', `chapter_${number}.md`),
    `# 第${number}章\n\n${content}`,
    'utf-8'
  )
}

function boundaryState(
  outputDir: string,
  memory: Pick<NonNullable<ReducedGraphState['storyMemory']>, 'foreshadows' | 'beats'>
): ReducedGraphState {
  const base = buildState(outputDir)
  return buildState(outputDir, {
    currentChapterIndex: 2,
    totalChapters: 4,
    story: { ...base.story, totalChapters: 4 },
    chapters: [
      null,
      null,
      {
        id: 'ch-3',
        storyId: 'test-story',
        number: 3,
        title: '幕末',
        outline: '幕末正文。',
        summary: null,
        foreshadows: null,
        status: 'drafting',
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    outline: [
      { number: 1, title: '一', description: '' },
      { number: 2, title: '二', description: '' },
      { number: 3, title: '幕末', description: '幕末正文。' },
      { number: 4, title: '新幕', description: '' },
    ],
    storyArc: {
      totalChapters: 4,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 3,
          title: '第一幕',
          theme: '',
          function: '',
          mandatoryBeats: [],
        },
        {
          index: 2,
          startChapter: 4,
          endChapter: 4,
          title: '第二幕',
          theme: '',
          function: '',
          mandatoryBeats: [],
        },
      ],
      keyBeats: [],
    },
    actProgress: {
      1: { consumed: [], pending: [] },
      2: { consumed: [], pending: [] },
    },
    storyMemory: {
      ...createEmptyStoryMemory(),
      foreshadows: memory.foreshadows,
      beats: memory.beats,
    },
  })
}

function testMemoryForeshadow(
  id: string,
  beatId: string | null,
  required = true,
  expectedFulfillChapter: number | null = 2
) {
  return {
    id,
    text: id,
    kind: null,
    introducedIn: 0,
    expectedFulfillChapter,
    fulfilledIn: null,
    required,
    beatId,
  }
}

function testMemoryBeat(id: string, actIndex: number) {
  return {
    id,
    description: id,
    actIndex,
    deadlineAct: actIndex,
    required: true,
    claimedIn: null,
    provenByEventIds: [],
  }
}
