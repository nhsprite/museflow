import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { finalizeChapter } from '@/graph/services/finalization/chapter.js'
import { getSummaryAgent } from '@/graph/agent-factory.js'
import { createEmptyStoryState } from '@/storage/meta/stores/story-state.js'
import type { ReducedGraphState } from '@/graph/state.js'
import type { ModelProvider } from '@/model/provider.js'
import type { ChapterSession } from '@/core/chapter-generation/routing/types.js'
import type { StoryEvent } from '@/types/story-memory.js'
import { proposeActBoundaryAdjustments, applyActBoundaryAdjustment } from '@/utils/story-arc.js'
import { logger } from '@/utils/logger.js'

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
