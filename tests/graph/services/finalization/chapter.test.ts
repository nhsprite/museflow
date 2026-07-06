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
          },
          {
            id: 'evt-2',
            type: 'task-create',
            taskId: 'task-1',
            description: '主角需要找到失散的同伴。',
            chapterIndex: 0,
            source: 'chapter',
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
    expect(result.foreshadowStack).toEqual([])
    expect(result.verifiedConstraints?.some((c) => c.text.includes('未完成任务'))).toBe(true)
    expect(result.currentChapterIndex).toBe(1)
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

  it('keeps text-only act-end claimed beats as warnings instead of blocking on prose matching', async () => {
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
          claimedBeatIds: [],
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

    expect(result.rewriteRequested).toBeFalsy()
    expect(result.currentChapterIndex).toBe(3)
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
