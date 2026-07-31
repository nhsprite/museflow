import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as contextJudge from '../../src/utils/context-judge.js'
import {
  expandOutlineForChapter,
  validateChapterTimeAnchor,
} from '../../src/core/outline-expander.js'
import { validateChapterPlanBudget } from '../../src/utils/chapter-planning.js'
import {
  createActPressureConstraint,
  createGenericVerifiedConstraint,
} from '../../src/utils/verified-constraints.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { ChapterPlan } from '../../src/agents/chapter-planner.js'
import type { ModelProvider } from '../../src/model/provider.js'
import { logger } from '../../src/utils/logger.js'
import { readChapterContent, writeOutlineContent } from '../../src/storage/filesystem/writer.js'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import { createEmptyStoryState } from '../../src/storage/meta/stores/story-state.js'
import type { ForeshadowMemory, StoryEvent } from '../../src/types/story-memory.js'

const testTempDir = join(tmpdir(), `museflow-outline-expander-${randomUUID().slice(0, 8)}`)

const { planChapterWithOverrideMock, verifyForeshadowPlanMock, verifyBeatClaimsMock } = vi.hoisted(
  () => ({
    planChapterWithOverrideMock: vi.fn(),
    verifyForeshadowPlanMock: vi.fn(),
    verifyBeatClaimsMock: vi.fn(),
  })
)

const mockChat = vi.fn(async (): Promise<string> => '')
const mockChatStructured = vi.fn()
const chapterOutlineRunMock = vi.fn()

function createMockProvider(): ModelProvider {
  return {
    chat: mockChat,
    chatStructured: mockChatStructured,
  }
}

vi.mock('../../src/graph/nodes/planning.js', () => ({
  plan_chapter_with_override: planChapterWithOverrideMock,
}))

vi.mock('../../src/graph/services/foreshadow-fulfillment/planning-verifier.js', () => ({
  verifyForeshadowPlan: verifyForeshadowPlanMock,
}))

vi.mock('../../src/graph/services/plot-advance/beat-claim-verifier.js', () => ({
  verifyBeatClaims: verifyBeatClaimsMock,
}))

vi.mock('../../src/graph/agent-factory.js', () => ({
  getChapterOutlineAgent: () => ({
    run: vi.fn(async (state: { chapterIndex?: number }) => chapterOutlineRunMock(state)),
  }),
}))

vi.mock('../../src/utils/context-judge.js', () => ({
  batchValidateTimeAnchors: vi.fn().mockResolvedValue([{ valid: true }]),
  batchDetectTimeJumps: vi.fn().mockResolvedValue([false]),
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  writeOutlineContent: vi.fn().mockResolvedValue(undefined),
  readChapterContent: vi.fn().mockResolvedValue(null),
}))

const storyArc = {
  totalChapters: 3,
  acts: [
    {
      index: 1,
      startChapter: 1,
      endChapter: 3,
      title: '第一幕',
      theme: '测试主题',
      function: '测试功能',
      mandatoryBeats: ['主角离开家乡'],
    },
  ],
  keyBeats: [],
}

const baseState: ReducedGraphState = {
  story: { id: 'story-1', title: 'Story', outputDir: testTempDir },
  idea: 'idea',
  genre: 'default',
  totalChapters: 3,
  world: null,
  characters: [],
  storyArc,
  outline: [
    { number: 1, title: '启程', description: '主角离开家乡。' },
    { number: 2, title: '遇敌', description: '主角遭遇敌人并暂时被困。' },
    { number: 3, title: '脱困', description: '主角脱困并反击。' },
  ],
  actProgress: { 1: { consumed: [], pending: ['主角离开家乡'] } },
  chapters: [null, null, null],
  currentChapterIndex: 1,
  foreshadowStack: [],
  chapterSummaries: ['第一章摘要'],
  pendingIssues: [],
  rewriteApproved: false,
  rewriteRequested: false,
  isWriting: true,
  writeOneChapterOnly: true,
  lastPrintedChapter: 0,
  lastTimelineSnapshot: null,
  chapterPlan: null,
  storyState: null,
  autoFixAttempts: 0,
}

function createCompleteChapterPlan(overrides: Partial<ChapterPlan> = {}): ChapterPlan {
  return {
    chapterIndex: 1,
    sections: [],
    timeline: [],
    outlineCheck: [],
    expectedEvents: [],
    claimedMandatoryBeatIds: [],
    claimedBeatIds: [],
    fulfilledForeshadowIds: [],
    introducedForeshadowIds: [],
    resolvedTaskIds: [],
    createdTaskIds: [],
    ...overrides,
  }
}

function createForeshadowFulfillEvent(foreshadowId: string, chapterIndex: number): StoryEvent {
  return {
    id: `event-${foreshadowId}`,
    type: 'foreshadow-fulfill',
    chapterIndex,
    source: 'outline',
    foreshadowId,
  }
}

function createRequiredForeshadow(
  id: string,
  expectedFulfillChapter: number | null,
  introducedIn = 0
): ForeshadowMemory {
  const resolutionPolicy =
    expectedFulfillChapter === null ? ('should_resolve' as const) : ('must_resolve' as const)
  return {
    id,
    text: `structured clue ${id}`,
    kind: 'plot',
    introducedIn,
    expectedFulfillChapter,
    fulfilledIn: null,
    resolutionPolicy,
    required: true,
    beatId: null,
  }
}

function stateWithScheduledForeshadows(
  chapterIndex: number,
  description: string,
  foreshadows: ForeshadowMemory[]
): ReducedGraphState {
  return {
    ...baseState,
    currentChapterIndex: chapterIndex,
    totalChapters: 4,
    story: { ...baseState.story, totalChapters: 4 },
    storyArc: {
      totalChapters: 4,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 3,
          title: '第一幕',
          theme: '建立',
          function: '推进',
          mandatoryBeats: [],
        },
        {
          index: 2,
          startChapter: 4,
          endChapter: 4,
          title: '第二幕',
          theme: '收束',
          function: '结束',
          mandatoryBeats: [],
        },
      ],
      keyBeats: [],
    },
    outline: [
      { number: 1, title: '第一章', description: '第一章既有大纲。' },
      { number: 2, title: '第二章', description: chapterIndex === 1 ? description : '第二章。' },
      { number: 3, title: '第三章', description: chapterIndex === 2 ? description : '第三章。' },
      { number: 4, title: '第四章', description: chapterIndex === 3 ? description : '第四章。' },
    ],
    actProgress: {
      1: { consumed: [], pending: [] },
      2: { consumed: [], pending: [] },
    },
    chapters: [null, null, null, null],
    storyMemory: {
      ...createEmptyStoryMemory(),
      foreshadows: Object.fromEntries(foreshadows.map((foreshadow) => [foreshadow.id, foreshadow])),
    },
  }
}

describe('expandOutlineForChapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: { sections: [] } })
    verifyForeshadowPlanMock.mockResolvedValue([])
    verifyBeatClaimsMock.mockResolvedValue([])
    mockChatStructured.mockResolvedValue({ results: [true, true] })
    mockChat.mockResolvedValue(JSON.stringify({ results: [true, true] }))
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '即时标题',
        description: '即时生成的描述。',
        introducedCharacters: [],
        claimedBeats: [],
      },
    })
  })

  it('calls plan_chapter with current and next chapter arcs when descriptions exist', async () => {
    await expandOutlineForChapter(baseState, 1, createMockProvider())

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    expect(chapterOutlineRunMock).not.toHaveBeenCalled()
    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
    expect(formattedOutline).toContain('第2章：遇敌')
    expect(formattedOutline).toContain('主角遭遇敌人并暂时被困')
  })

  it('canonicalizes a persisted covered-key claim to its mandatory beat id', async () => {
    const aliasState: ReducedGraphState = {
      ...baseState,
      storyArc: {
        ...storyArc,
        keyBeats: [
          {
            id: 'A1-B1',
            beat: '主角离开家乡',
            deadlineAct: 1,
            required: true,
            coveredByMandatoryBeatId: 'A1-M1',
          },
        ],
      },
      outline: baseState.outline.map((item, index) =>
        index === 1 ? { ...item, claimedBeatIds: ['A1-B1'] } : item
      ),
    }

    const result = await expandOutlineForChapter(aliasState, 1, createMockProvider())

    expect(result.outline?.[1]?.claimedBeatIds).toEqual([])
    expect(result.outline?.[1]?.claimedMandatoryBeatIds).toEqual(['A1-M1'])
    expect(result.outline?.[1]?.claimedBeats).toEqual(['主角离开家乡'])
    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
    expect(formattedOutline).toContain('【本章认领 mandatory beats】A1-M1')
    expect(formattedOutline).not.toContain('【本章认领 key beats】A1-B1')
  })

  it('generates JIT outline when description is empty', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '脱困', description: '主角脱困并反击。' },
      ],
    }

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    expect(result.outline?.[1]?.title).toBe('即时标题')
    expect(result.outline?.[1]?.description).toBe('即时生成的描述。')
    expect(writeOutlineContent).not.toHaveBeenCalled()
  })

  it('forces outline regeneration with beat claim rejection feedback even when description exists', async () => {
    const beatClaimRejection = {
      rejectedClaims: [
        { beatId: 'A1-M1', beat: '主角离开家乡', reason: '正文证据仅描写阅读行为，未呈现节拍事件' },
      ],
      requiredClaims: {
        pendingMandatoryBeats: [{ beatId: 'A1-M1', beat: '主角离开家乡' }],
        chaptersRemainingInAct: 1,
      },
      currentOutline: { title: '遇敌', description: '主角遭遇敌人并暂时被困。' },
    }

    const result = await expandOutlineForChapter(baseState, 1, createMockProvider(), {
      beatClaimRejection,
    })

    // description 已存在也必须重生成大纲，且首轮 agent 输入即携带驳回反馈
    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    const agentInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      beatClaimRejection?: typeof beatClaimRejection
    }
    expect(agentInput.beatClaimRejection).toEqual(beatClaimRejection)
    expect(result.outline?.[1]?.title).toBe('即时标题')
    expect(result.outline?.[1]?.description).toBe('即时生成的描述。')
  })

  it('passes current state snapshot to JIT outline agent', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '脱困', description: '主角脱困并反击。' },
      ],
      storyState: {
        ...createEmptyStoryState(),
        storyTime: '清晨',
        chapterHandoff: {
          chapterNumber: 1,
          endTime: '清晨',
          charactersPresent: ['c-hero'],
          endScene: '旧宅门口',
          lastAction: '主角跨出门槛',
          openQuestions: [],
        },
      },
      storyMemory: {
        ...createEmptyStoryMemory(),
        entities: {
          ...createEmptyStoryMemory().entities,
          characters: {
            'c-hero': {
              id: 'c-hero',
              name: '主角',
              locationId: 'l-old-house',
              status: {},
              introducedIn: 0,
            },
          },
          locations: {
            'l-old-house': { id: 'l-old-house', name: '旧宅', introducedIn: 0 },
          },
        },
      },
    }

    await expandOutlineForChapter(jitState, 1, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    const agentInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      currentStateSnapshot?: string
    }
    expect(agentInput.currentStateSnapshot).toContain('清晨')
    expect(agentInput.currentStateSnapshot).toContain('c-hero')
    expect(agentInput.currentStateSnapshot).toContain('旧宅')
  })

  it('retries JIT outline with beat claim rejection feedback when a claim is not realized', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '脱困', description: '主角脱困并反击。' },
      ],
    }
    chapterOutlineRunMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '静守',
          description: '二人在屋内静守至天明。',
          introducedCharacters: [],
          claimedBeats: ['主角离开家乡'],
          claimedMandatoryBeatIds: ['A1-M1'],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '离乡',
          description: '主角收拾行囊，拜别乡亲离开家乡。',
          introducedCharacters: [],
          claimedBeats: ['主角离开家乡'],
          claimedMandatoryBeatIds: ['A1-M1'],
        },
      })
    verifyBeatClaimsMock.mockResolvedValueOnce([
      { beatId: 'A1-M1', beat: '主角离开家乡', reason: 'description 只有静守，没有离乡事件' },
    ])

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    expect(verifyBeatClaimsMock).toHaveBeenCalledTimes(2)
    expect(verifyBeatClaimsMock.mock.calls[0]![0]).toMatchObject({
      claims: [{ beatId: 'A1-M1', beat: '主角离开家乡' }],
      outlineDescription: '二人在屋内静守至天明。',
    })
    // 第二轮候选再次认领同一节拍，必须用修订后的 description 重新校验
    expect(verifyBeatClaimsMock.mock.calls[1]![0]).toMatchObject({
      claims: [{ beatId: 'A1-M1', beat: '主角离开家乡' }],
      outlineDescription: '主角收拾行囊，拜别乡亲离开家乡。',
    })
    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(2)
    const retryInput = chapterOutlineRunMock.mock.calls[1]![0] as {
      beatClaimRejection?: {
        rejectedClaims: Array<{ beatId: string; beat: string; reason: string }>
        currentOutline?: { title: string; description: string }
      }
    }
    expect(retryInput.beatClaimRejection?.rejectedClaims).toEqual([
      { beatId: 'A1-M1', beat: '主角离开家乡', reason: 'description 只有静守，没有离乡事件' },
    ])
    expect(retryInput.beatClaimRejection?.currentOutline).toEqual({
      title: '静守',
      description: '二人在屋内静守至天明。',
    })
    expect(result.outline?.[1]?.claimedMandatoryBeatIds).toEqual(['A1-M1'])
  })

  it('strips unrealized beat claims after JIT retry exhaustion and emits a warning issue', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '脱困', description: '主角脱困并反击。' },
      ],
    }
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '静守',
        description: '二人在屋内静守至天明。',
        introducedCharacters: [],
        claimedBeats: ['主角离开家乡'],
        claimedMandatoryBeatIds: ['A1-M1'],
      },
    })
    verifyBeatClaimsMock.mockResolvedValue([
      { beatId: 'A1-M1', beat: '主角离开家乡', reason: 'description 只有静守，没有离乡事件' },
    ])

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(3)
    expect(result.outline?.[1]?.claimedMandatoryBeatIds).toEqual([])
    expect(result.outline?.[1]?.claimedBeats).toEqual([])
    expect(
      result.pendingIssues?.some(
        (issue) => issue.type === 'outline_beat_claim' && issue.severity === 'warning'
      )
    ).toBe(true)
  })

  it('retries JIT outline when zero mandatory beats are claimed under high act-boundary pressure', async () => {
    // 第 3 章（幕末）：pending 1 个 beat、剩余 0 章 → pending > 剩余章数，高压
    const jitState: ReducedGraphState = {
      ...baseState,
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。' },
        { number: 2, title: '遇敌', description: '主角遭遇敌人并暂时被困。' },
        { number: 3, title: '', description: '' },
      ],
    }
    chapterOutlineRunMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '静守',
          description: '二人在屋内静守至天明，没有任何事件发生。',
          introducedCharacters: [],
          claimedBeats: [],
          claimedMandatoryBeatIds: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '离乡',
          description: '主角收拾行囊，拜别乡亲离开家乡。',
          introducedCharacters: [],
          claimedBeats: ['主角离开家乡'],
          claimedMandatoryBeatIds: ['A1-M1'],
        },
      })

    const result = await expandOutlineForChapter(jitState, 2, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(2)
    // 幕边界压力文本注入大纲阶段（此前只注入规划阶段）
    const firstInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      verifiedConstraints?: string[]
      mandatoryBeatClaimRequired?: boolean
    }
    expect(
      firstInput.verifiedConstraints?.some((text) => text.includes('【幕边界压力 - 高】'))
    ).toBe(true)
    // 高压标记传给 prompt，用于关闭"本章可不推进"的逃逸口
    expect(firstInput.mandatoryBeatClaimRequired).toBe(true)
    // 打回反馈：必须至少认领 1 个 pending mandatory beat
    const retryInput = chapterOutlineRunMock.mock.calls[1]![0] as {
      beatClaimRejection?: {
        rejectedClaims: unknown[]
        requiredClaims?: {
          pendingMandatoryBeats: Array<{ beatId: string; beat: string }>
          chaptersRemainingInAct: number
        }
      }
    }
    expect(retryInput.beatClaimRejection?.rejectedClaims).toEqual([])
    expect(retryInput.beatClaimRejection?.requiredClaims).toEqual({
      pendingMandatoryBeats: [{ beatId: 'A1-M1', beat: '主角离开家乡' }],
      chaptersRemainingInAct: 0,
    })
    expect(result.outline?.[2]?.claimedMandatoryBeatIds).toEqual(['A1-M1'])
  })

  it('aborts the chapter when zero-claim retries are exhausted under high pressure', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。' },
        { number: 2, title: '遇敌', description: '主角遭遇敌人并暂时被困。' },
        { number: 3, title: '', description: '' },
      ],
    }
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '静守',
        description: '二人在屋内静守至天明，没有任何事件发生。',
        introducedCharacters: [],
        claimedBeats: [],
        claimedMandatoryBeatIds: [],
      },
    })

    await expect(expandOutlineForChapter(jitState, 2, createMockProvider())).rejects.toThrow(
      /连续 3 次未认领任何 mandatory beat/
    )
    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(3)
  })

  it('aborts the chapter when claim stripping leaves zero mandatory claims under high pressure', async () => {
    // 第 3 章（幕末）：pending 1 个 beat、剩余 0 章 → 高压。
    // 认领未通过 description 呈现校验而被剥离后同样不得放行零认领大纲。
    const jitState: ReducedGraphState = {
      ...baseState,
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。' },
        { number: 2, title: '遇敌', description: '主角遭遇敌人并暂时被困。' },
        { number: 3, title: '', description: '' },
      ],
    }
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '静守',
        description: '二人在屋内静守至天明。',
        introducedCharacters: [],
        claimedBeats: ['主角离开家乡'],
        claimedMandatoryBeatIds: ['A1-M1'],
      },
    })
    verifyBeatClaimsMock.mockResolvedValue([
      { beatId: 'A1-M1', beat: '主角离开家乡', reason: 'description 只有静守，没有离乡事件' },
    ])

    await expect(expandOutlineForChapter(jitState, 2, createMockProvider())).rejects.toThrow(
      /未能形成有效 mandatory beat 认领/
    )
    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(3)
  })

  it('retries then soft-lands zero-claim outlines under pacing (medium) pressure', async () => {
    // 第 2 章（第 2 幕第 2-4 章）：2 个 pending、剩余槽位含本章 3 章 → 2×2 > 3 → 配速中压
    const jitState: ReducedGraphState = {
      ...baseState,
      totalChapters: 4,
      storyArc: {
        totalChapters: 4,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '旧幕',
            theme: '',
            function: '',
            mandatoryBeats: ['旧幕节拍'],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 4,
            title: '新幕',
            theme: '',
            function: '',
            mandatoryBeats: ['新幕节拍一', '新幕节拍二'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        { number: 1, title: '旧幕收束', description: '旧幕节拍已完成。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '新幕继续', description: '新幕继续推进。' },
        { number: 4, title: '新幕收束', description: '新幕完成收束。' },
      ],
      actProgress: {
        1: { consumed: ['旧幕节拍'], pending: [] },
        2: { consumed: [], pending: ['新幕节拍一', '新幕节拍二'] },
      },
    }
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '静守',
        description: '二人在屋内静守至天明，没有任何事件发生。',
        introducedCharacters: [],
        claimedBeats: [],
        claimedMandatoryBeatIds: [],
      },
    })

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    // 中压同样要求认领并打回重试，但耗尽后软着陆，不中止章节
    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(3)
    const firstInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      mandatoryBeatClaimRequired?: boolean
    }
    expect(firstInput.mandatoryBeatClaimRequired).toBe(true)
    const retryInput = chapterOutlineRunMock.mock.calls[1]![0] as {
      beatClaimRejection?: {
        requiredClaims?: {
          pendingMandatoryBeats: Array<{ beatId: string; beat: string }>
          chaptersRemainingInAct: number
        }
      }
    }
    expect(retryInput.beatClaimRejection?.requiredClaims).toEqual({
      pendingMandatoryBeats: [
        { beatId: 'A2-M1', beat: '新幕节拍一' },
        { beatId: 'A2-M2', beat: '新幕节拍二' },
      ],
      chaptersRemainingInAct: 2,
    })
    expect(result.outline?.[1]?.claimedMandatoryBeatIds).toEqual([])
    expect(
      result.pendingIssues?.some(
        (issue) =>
          issue.ruleId === 'outline.zero-claim-under-pacing-pressure' &&
          issue.severity === 'warning'
      )
    ).toBe(true)
  })

  it('soft-lands after claim stripping under pacing (medium) pressure', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      totalChapters: 4,
      storyArc: {
        totalChapters: 4,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '旧幕',
            theme: '',
            function: '',
            mandatoryBeats: ['旧幕节拍'],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 4,
            title: '新幕',
            theme: '',
            function: '',
            mandatoryBeats: ['新幕节拍一', '新幕节拍二'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        { number: 1, title: '旧幕收束', description: '旧幕节拍已完成。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '新幕继续', description: '新幕继续推进。' },
        { number: 4, title: '新幕收束', description: '新幕完成收束。' },
      ],
      actProgress: {
        1: { consumed: ['旧幕节拍'], pending: [] },
        2: { consumed: [], pending: ['新幕节拍一', '新幕节拍二'] },
      },
    }
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '静守',
        description: '二人在屋内静守至天明。',
        introducedCharacters: [],
        claimedBeats: ['新幕节拍一'],
        claimedMandatoryBeatIds: ['A2-M1'],
      },
    })
    verifyBeatClaimsMock.mockResolvedValue([
      { beatId: 'A2-M1', beat: '新幕节拍一', reason: 'description 只有静守，没有节拍事件' },
    ])

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(3)
    expect(result.outline?.[1]?.claimedMandatoryBeatIds).toEqual([])
    expect(
      result.pendingIssues?.some((issue) => issue.ruleId === 'outline.beat-claim-stripped')
    ).toBe(true)
  })

  it('does not retry zero-claim outlines when act-boundary pressure is below high', async () => {
    // 第 2 章：pending 1 个 beat、剩余槽位含本章 2 章 → 1×2 不 > 2 → 低压，不打回
    const jitState: ReducedGraphState = {
      ...baseState,
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '脱困', description: '主角脱困并反击。' },
      ],
    }

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    expect(result.outline?.[1]?.claimedMandatoryBeatIds).toEqual([])
  })

  it('does not treat an overdue key beat as mandatory beat high pressure', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      totalChapters: 6,
      story: { ...baseState.story, totalChapters: 6 },
      currentChapterIndex: 1,
      storyArc: {
        totalChapters: 6,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '上一幕',
            theme: '建立',
            function: '开端',
            mandatoryBeats: [],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 6,
            title: '当前幕',
            theme: '发展',
            function: '推进',
            mandatoryBeats: ['当前幕节拍'],
          },
        ],
        keyBeats: [{ id: 'A1-B1', beat: '上一幕关键节拍', deadlineAct: 1, required: true }],
      },
      outline: [
        { number: 1, title: '上一幕', description: '上一幕结束。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '', description: '' },
        { number: 4, title: '', description: '' },
        { number: 5, title: '', description: '' },
        { number: 6, title: '', description: '' },
      ],
      actProgress: {
        1: { consumed: [], pending: [] },
        2: { consumed: [], pending: ['当前幕节拍'] },
      },
      chapters: [null, null, null, null, null, null],
      storyMemory: createEmptyStoryMemory(),
    }

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    const agentInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      verifiedConstraints?: string[]
      mandatoryBeatClaimRequired?: boolean
    }
    expect(agentInput.mandatoryBeatClaimRequired).toBeUndefined()
    expect(
      agentInput.verifiedConstraints?.some((text) => text.includes('【幕边界压力 - 高】')) ?? false
    ).toBe(false)
    expect(result.outline?.[1]?.claimedMandatoryBeatIds).toEqual([])
  })

  it('skips beat claim verification when the candidate has no claims', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '脱困', description: '主角脱困并反击。' },
      ],
    }

    await expandOutlineForChapter(jitState, 1, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    expect(verifyBeatClaimsMock).not.toHaveBeenCalled()
  })

  it('keeps planner fulfillment evidence when it covers the outline claim', async () => {
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [
      createRequiredForeshadow('fs-due', 2),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 1 ? { ...item, fulfilledForeshadowIds: ['fs-due'] } : item
      ),
    }
    const stalePlan = createCompleteChapterPlan({
      chapterIndex: 0,
      fulfilledForeshadowIds: ['fs-due'],
      expectedEvents: [createForeshadowFulfillEvent('fs-due', 0)],
    })
    const requestedPlan = createCompleteChapterPlan({
      chapterIndex: 0,
      fulfilledForeshadowIds: ['fs-due'],
      expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({ chapterPlan: requestedPlan })

    const result = await expandOutlineForChapter(
      { ...state, chapterPlan: stalePlan },
      1,
      createMockProvider()
    )

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    expect(result.chapterPlan.chapterIndex).toBe(1)
    expect(result.chapterPlan.fulfilledForeshadowIds).toEqual(['fs-due'])
    expect(result.chapterPlan.expectedEvents).toEqual(requestedPlan.expectedEvents)
  })

  it('preserves legacy plan fulfillment evidence when story memory is null', async () => {
    const legacyPlan = createCompleteChapterPlan({
      chapterIndex: 1,
      fulfilledForeshadowIds: ['legacy-foreshadow'],
      expectedEvents: [createForeshadowFulfillEvent('legacy-foreshadow', 1)],
    })

    const result = await expandOutlineForChapter(
      {
        ...baseState,
        storyMemory: null,
        foreshadowStack: [
          {
            id: 'legacy-foreshadow',
            text: 'Legacy foreshadow',
            expectedFulfillChapter: 3,
            createdAt: 0,
            createdAtChapter: 1,
            status: 'planted',
            isExplicit: false,
            required: true,
          },
        ],
        chapterPlan: legacyPlan,
      },
      1,
      createMockProvider()
    )

    expect(planChapterWithOverrideMock).not.toHaveBeenCalled()
    expect(result.chapterPlan.fulfilledForeshadowIds).toEqual(['legacy-foreshadow'])
    expect(result.chapterPlan.expectedEvents).toEqual([
      createForeshadowFulfillEvent('legacy-foreshadow', 1),
    ])
  })

  it('replans a reusable chapter plan whose expected events reference unauthorized IDs', async () => {
    const storyMemory = {
      ...createEmptyStoryMemory(),
      entities: {
        ...createEmptyStoryMemory().entities,
        characters: {
          'character-main': {
            id: 'character-main',
            name: 'Main',
            locationId: 'l-1',
            status: {},
            introducedIn: 0,
          },
        },
        locations: {
          'l-1': { id: 'l-1', name: 'Known place', introducedIn: 0 },
        },
      },
    }
    const unauthorizedPlan = createCompleteChapterPlan({
      chapterIndex: 1,
      expectedEvents: [
        {
          id: 'evt-unauthorized-location',
          type: 'character-location',
          characterId: 'character-unknown',
          locationId: 'location-unknown',
          chapterIndex: 1,
          source: 'chapter',
        },
      ],
    })
    const replacementPlan = createCompleteChapterPlan({
      chapterIndex: 1,
      expectedEvents: [
        {
          id: 'evt-authorized-location',
          type: 'character-location',
          characterId: 'character-main',
          locationId: 'l-1',
          chapterIndex: 1,
          source: 'chapter',
        },
      ],
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({ chapterPlan: replacementPlan })

    const result = await expandOutlineForChapter(
      { ...baseState, storyMemory, chapterPlan: unauthorizedPlan },
      1,
      createMockProvider()
    )

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    expect(result.chapterPlan).toEqual(replacementPlan)
  })

  it('reuses a chapter plan whose expected events reference authoritative l-1', async () => {
    const storyMemory = {
      ...createEmptyStoryMemory(),
      entities: {
        ...createEmptyStoryMemory().entities,
        characters: {
          'character-main': {
            id: 'character-main',
            name: 'Main',
            locationId: 'l-1',
            status: {},
            introducedIn: 0,
          },
        },
        locations: {
          'l-1': { id: 'l-1', name: 'Known place', introducedIn: 0 },
        },
      },
    }
    const reusablePlan = createCompleteChapterPlan({
      chapterIndex: 1,
      expectedEvents: [
        {
          id: 'evt-authorized-location',
          type: 'character-location',
          characterId: 'character-main',
          locationId: 'l-1',
          chapterIndex: 1,
          source: 'chapter',
        },
      ],
    })

    const result = await expandOutlineForChapter(
      { ...baseState, storyMemory, chapterPlan: reusablePlan },
      1,
      createMockProvider()
    )

    expect(planChapterWithOverrideMock).not.toHaveBeenCalled()
    expect(result.chapterPlan).toEqual(reusablePlan)
  })

  it('removes an internal legacy conflict signal when compliance auto-defers the claim', async () => {
    const outline = baseState.outline.map((item, index) =>
      index === 1 ? { ...item, fulfilledForeshadowIds: ['legacy-foreshadow'] } : item
    )
    const conflictingPlan = createCompleteChapterPlan({
      chapterIndex: 1,
      fulfilledForeshadowIds: ['legacy-foreshadow'],
      expectedEvents: [
        { ...createForeshadowFulfillEvent('legacy-foreshadow', 1), source: 'outline' },
        { ...createForeshadowFulfillEvent('legacy-foreshadow', 1), source: 'chapter' },
      ],
    })
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: conflictingPlan })

    const result = await expandOutlineForChapter(
      {
        ...baseState,
        outline,
        storyMemory: null,
        foreshadowStack: [
          {
            id: 'legacy-foreshadow',
            text: 'Legacy foreshadow',
            expectedFulfillChapter: 3,
            createdAt: 0,
            createdAtChapter: 1,
            status: 'planted',
            isExplicit: false,
            required: true,
          },
        ],
        chapterPlan: conflictingPlan,
      },
      1,
      createMockProvider()
    )

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    expect(result.chapterPlan.fulfilledForeshadowIds).toEqual([])
    expect(result.chapterPlan.expectedEvents).toEqual([])
    expect(result.chapterPlan).not.toHaveProperty('foreshadowFulfillmentConflictIds')
  })

  it('canonicalizes outline and plan foreshadow claims without mutating their inputs', async () => {
    const canonical = createRequiredForeshadow('fs-early', 2)
    const alias = { ...createRequiredForeshadow('fs-late', 2, 1), mergedInto: 'fs-early' }
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [canonical, alias])
    const outlineItem = {
      ...scheduledState.outline[1]!,
      fulfilledForeshadowIds: ['fs-late', 'fs-early', 'fs-late'],
      deferredForeshadowIds: [],
    }
    const aliasEvent: StoryEvent = {
      ...createForeshadowFulfillEvent('fs-late', 1),
      id: 'event-first-alias',
      evidence: { paragraphIndex: 3 },
    }
    const unrelatedEvent: StoryEvent = {
      id: 'event-location',
      type: 'character-location',
      characterId: 'character-1',
      locationId: 'location-1',
      chapterIndex: 1,
      source: 'outline',
    }
    const canonicalEvent: StoryEvent = {
      ...createForeshadowFulfillEvent('fs-early', 1),
      id: 'event-second-canonical',
      evidence: { paragraphIndex: 3 },
    }
    const chapterPlan = createCompleteChapterPlan({
      fulfilledForeshadowIds: ['fs-late', 'fs-early'],
      expectedEvents: [aliasEvent, unrelatedEvent, canonicalEvent],
    })
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) => (index === 1 ? outlineItem : item)),
      storyMemory: {
        ...scheduledState.storyMemory!,
        entities: {
          ...scheduledState.storyMemory!.entities,
          characters: {
            ...scheduledState.storyMemory!.entities.characters,
            'character-1': {
              id: 'character-1',
              name: 'Character',
              locationId: 'location-1',
              status: {},
              introducedIn: 0,
            },
          },
          locations: {
            ...scheduledState.storyMemory!.entities.locations,
            'location-1': { id: 'location-1', name: 'Location', introducedIn: 0 },
          },
        },
      },
      chapterPlan,
    }

    const result = await expandOutlineForChapter(state, 1, createMockProvider())

    expect(result.outline?.[1]?.fulfilledForeshadowIds).toEqual(['fs-early'])
    expect(result.outline?.[1]?.deferredForeshadowIds).toEqual([])
    expect(result.chapterPlan.fulfilledForeshadowIds).toEqual(['fs-early'])
    expect(result.chapterPlan.expectedEvents).toEqual([
      { ...aliasEvent, foreshadowId: 'fs-early' },
      unrelatedEvent,
    ])
    expect(state.outline[1]).toBe(outlineItem)
    expect(outlineItem.fulfilledForeshadowIds).toEqual(['fs-late', 'fs-early', 'fs-late'])
    expect(chapterPlan.fulfilledForeshadowIds).toEqual(['fs-late', 'fs-early'])
    expect(chapterPlan.expectedEvents).toEqual([aliasEvent, unrelatedEvent, canonicalEvent])
  })

  it('fails closed when a historical alias merge leaves an outline decision on both sides', async () => {
    const canonical = createRequiredForeshadow('fs-root', 2)
    const alias = { ...createRequiredForeshadow('fs-alias', 2, 1), mergedInto: 'fs-root' }
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [canonical, alias])
    const ambiguousOutline = {
      ...scheduledState.outline[1]!,
      fulfilledForeshadowIds: ['fs-root'],
      deferredForeshadowIds: ['fs-alias'],
    }
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '仍然冲突',
        description: '修订结果仍给出相反的结构化裁决。',
        fulfilledForeshadowIds: ['fs-root'],
        deferredForeshadowIds: ['fs-alias'],
      },
    })

    await expect(
      expandOutlineForChapter(
        {
          ...scheduledState,
          outline: scheduledState.outline.map((item, index) =>
            index === 1 ? ambiguousOutline : item
          ),
        },
        1,
        createMockProvider()
      )
    ).rejects.toThrow('无法裁决相互冲突的伏笔决策：fs-root')

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(3)
    const correction = chapterOutlineRunMock.mock.calls[1]![0] as {
      foreshadowPlanningRejection?: { conflictingDecisionIds?: string[] }
    }
    expect(correction.foreshadowPlanningRejection?.conflictingDecisionIds).toEqual(['fs-root'])
    expect(planChapterWithOverrideMock).not.toHaveBeenCalled()
  })

  it('accepts an exact-one outline decision from canonical conflict correction', async () => {
    const canonical = createRequiredForeshadow('fs-root', 2)
    const alias = { ...createRequiredForeshadow('fs-alias', 2, 1), mergedInto: 'fs-root' }
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [canonical, alias])
    const ambiguousOutline = {
      ...scheduledState.outline[1]!,
      fulfilledForeshadowIds: ['fs-root'],
      deferredForeshadowIds: ['fs-alias'],
    }
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '明确兑现',
        description: '修订后只保留一个结构化裁决。',
        fulfilledForeshadowIds: ['fs-alias'],
        deferredForeshadowIds: [],
      },
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 1,
        fulfilledForeshadowIds: ['fs-alias'],
        expectedEvents: [createForeshadowFulfillEvent('fs-alias', 1)],
      }),
    })

    const result = await expandOutlineForChapter(
      {
        ...scheduledState,
        outline: scheduledState.outline.map((item, index) =>
          index === 1 ? ambiguousOutline : item
        ),
      },
      1,
      createMockProvider()
    )

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    expect(result.outline?.[1]?.fulfilledForeshadowIds).toEqual(['fs-root'])
    expect(result.outline?.[1]?.deferredForeshadowIds).toEqual([])
    expect(result.chapterPlan.fulfilledForeshadowIds).toEqual(['fs-root'])
    expect(result.chapterPlan.expectedEvents).toEqual([
      { ...createForeshadowFulfillEvent('fs-alias', 1), foreshadowId: 'fs-root' },
    ])
  })

  it('corrects plan fulfillment claims for a canonically deferred outline decision', async () => {
    const canonical = createRequiredForeshadow('fs-root', 2)
    const alias = { ...createRequiredForeshadow('fs-alias', 2, 1), mergedInto: 'fs-root' }
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [canonical, alias])
    const deferredOutline = {
      ...scheduledState.outline[1]!,
      fulfilledForeshadowIds: [],
      deferredForeshadowIds: ['fs-alias'],
    }
    const contradictoryPlan = createCompleteChapterPlan({
      chapterIndex: 1,
      fulfilledForeshadowIds: ['fs-alias'],
      expectedEvents: [createForeshadowFulfillEvent('fs-alias', 1)],
    })
    const correctedPlan = createCompleteChapterPlan({ chapterIndex: 1 })
    planChapterWithOverrideMock.mockResolvedValueOnce({ chapterPlan: correctedPlan })

    const result = await expandOutlineForChapter(
      {
        ...scheduledState,
        outline: scheduledState.outline.map((item, index) =>
          index === 1 ? deferredOutline : item
        ),
        chapterPlan: contradictoryPlan,
      },
      1,
      createMockProvider()
    )

    expect(chapterOutlineRunMock).not.toHaveBeenCalled()
    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    const correction = planChapterWithOverrideMock.mock.calls[0]![3] as {
      foreshadowPlanningRejection?: { forbiddenFulfillmentIds?: string[] }
    }
    expect(correction.foreshadowPlanningRejection?.forbiddenFulfillmentIds).toEqual(['fs-root'])
    expect(result.outline?.[1]?.fulfilledForeshadowIds).toEqual([])
    expect(result.outline?.[1]?.deferredForeshadowIds).toEqual(['fs-root'])
    expect(result.chapterPlan.fulfilledForeshadowIds).toEqual([])
    expect(result.chapterPlan.expectedEvents).toEqual([])
  })

  it('corrects a fresh plan fulfillment event for a canonically deferred outline decision', async () => {
    const canonical = createRequiredForeshadow('fs-root', 2)
    const alias = { ...createRequiredForeshadow('fs-alias', 2, 1), mergedInto: 'fs-root' }
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [canonical, alias])
    const deferredOutline = {
      ...scheduledState.outline[1]!,
      fulfilledForeshadowIds: [],
      deferredForeshadowIds: ['fs-alias'],
    }
    const contradictoryPlan = createCompleteChapterPlan({
      chapterIndex: 1,
      expectedEvents: [createForeshadowFulfillEvent('fs-alias', 1)],
    })
    const correctedPlan = createCompleteChapterPlan({ chapterIndex: 1 })
    planChapterWithOverrideMock
      .mockResolvedValueOnce({ chapterPlan: contradictoryPlan })
      .mockResolvedValueOnce({ chapterPlan: correctedPlan })

    const result = await expandOutlineForChapter(
      {
        ...scheduledState,
        outline: scheduledState.outline.map((item, index) =>
          index === 1 ? deferredOutline : item
        ),
      },
      1,
      createMockProvider()
    )

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(2)
    const correction = planChapterWithOverrideMock.mock.calls[1]![3] as {
      foreshadowPlanningRejection?: { forbiddenFulfillmentIds?: string[] }
    }
    expect(correction.foreshadowPlanningRejection?.forbiddenFulfillmentIds).toEqual(['fs-root'])
    expect(result.outline?.[1]?.deferredForeshadowIds).toEqual(['fs-root'])
    expect(result.chapterPlan.fulfilledForeshadowIds).toEqual([])
    expect(result.chapterPlan.expectedEvents).toEqual([])
  })

  it('routes structurally conflicting fulfillment events with the same raw id through compliance', async () => {
    const scheduledState = stateWithScheduledForeshadows(2, '幕末既有大纲。', [
      createRequiredForeshadow('fs-due', 3),
    ])
    const outlineItem = {
      ...scheduledState.outline[2]!,
      fulfilledForeshadowIds: ['fs-due'],
    }
    const conflictingPlan = createCompleteChapterPlan({
      chapterIndex: 2,
      fulfilledForeshadowIds: ['fs-due'],
      expectedEvents: [
        { ...createForeshadowFulfillEvent('fs-due', 2), source: 'outline' },
        { ...createForeshadowFulfillEvent('fs-due', 2), source: 'chapter' },
      ],
    })
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: conflictingPlan })

    await expect(
      expandOutlineForChapter(
        {
          ...scheduledState,
          outline: scheduledState.outline.map((item, index) => (index === 2 ? outlineItem : item)),
          chapterPlan: conflictingPlan,
        },
        2,
        createMockProvider()
      )
    ).rejects.toThrow('无法为本章必须回收的伏笔生成结构化证据：fs-due')
    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
  })

  it('preserves a raw chapter-index conflict across reusable-plan normalization', async () => {
    const canonical = createRequiredForeshadow('fs-early', 3)
    const alias = { ...createRequiredForeshadow('fs-late', 3, 1), mergedInto: 'fs-early' }
    const scheduledState = stateWithScheduledForeshadows(2, '幕末既有大纲。', [canonical, alias])
    const outlineItem = {
      ...scheduledState.outline[2]!,
      fulfilledForeshadowIds: ['fs-late', 'fs-early'],
    }
    const conflictingPlan = createCompleteChapterPlan({
      chapterIndex: 2,
      fulfilledForeshadowIds: ['fs-late', 'fs-early'],
      expectedEvents: [
        createForeshadowFulfillEvent('fs-late', 1),
        createForeshadowFulfillEvent('fs-early', 2),
      ],
    })
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: conflictingPlan })

    await expect(
      expandOutlineForChapter(
        {
          ...scheduledState,
          outline: scheduledState.outline.map((item, index) => (index === 2 ? outlineItem : item)),
          chapterPlan: conflictingPlan,
        },
        2,
        createMockProvider()
      )
    ).rejects.toThrow('无法为本章必须回收的伏笔生成结构化证据：fs-early')
    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
  })

  it('routes conflicting source fields from different aliases through plan compliance', async () => {
    const canonical = createRequiredForeshadow('fs-root', 3)
    const firstAlias = { ...createRequiredForeshadow('fs-alias-a', 3, 1), mergedInto: 'fs-root' }
    const secondAlias = { ...createRequiredForeshadow('fs-alias-b', 3, 1), mergedInto: 'fs-root' }
    const scheduledState = stateWithScheduledForeshadows(2, '幕末既有大纲。', [
      canonical,
      firstAlias,
      secondAlias,
    ])
    const outlineItem = {
      ...scheduledState.outline[2]!,
      fulfilledForeshadowIds: ['fs-alias-a', 'fs-alias-b'],
    }
    const conflictingPlan = createCompleteChapterPlan({
      chapterIndex: 2,
      fulfilledForeshadowIds: ['fs-alias-a', 'fs-alias-b'],
      expectedEvents: [
        { ...createForeshadowFulfillEvent('fs-alias-a', 2), source: 'outline' },
        { ...createForeshadowFulfillEvent('fs-alias-b', 2), source: 'chapter' },
      ],
    })
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: conflictingPlan })

    await expect(
      expandOutlineForChapter(
        {
          ...scheduledState,
          outline: scheduledState.outline.map((item, index) => (index === 2 ? outlineItem : item)),
          chapterPlan: conflictingPlan,
        },
        2,
        createMockProvider()
      )
    ).rejects.toThrow('无法为本章必须回收的伏笔生成结构化证据：fs-root')
    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
  })

  it('drops the internal conflict signal after a compliant corrective replan', async () => {
    const canonical = createRequiredForeshadow('fs-root', 3)
    const alias = { ...createRequiredForeshadow('fs-alias', 3, 1), mergedInto: 'fs-root' }
    const scheduledState = stateWithScheduledForeshadows(2, '幕末既有大纲。', [canonical, alias])
    const outlineItem = {
      ...scheduledState.outline[2]!,
      fulfilledForeshadowIds: ['fs-alias'],
    }
    const conflictingPlan = createCompleteChapterPlan({
      chapterIndex: 2,
      fulfilledForeshadowIds: ['fs-alias'],
      expectedEvents: [
        { ...createForeshadowFulfillEvent('fs-alias', 2), source: 'outline' },
        { ...createForeshadowFulfillEvent('fs-root', 2), source: 'chapter' },
      ],
    })
    const correctedPlan = createCompleteChapterPlan({
      chapterIndex: 2,
      fulfilledForeshadowIds: ['fs-root'],
      expectedEvents: [createForeshadowFulfillEvent('fs-root', 2)],
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({ chapterPlan: correctedPlan })

    const result = await expandOutlineForChapter(
      {
        ...scheduledState,
        outline: scheduledState.outline.map((item, index) => (index === 2 ? outlineItem : item)),
        chapterPlan: conflictingPlan,
      },
      2,
      createMockProvider()
    )

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    expect(result.chapterPlan.expectedEvents).toEqual([createForeshadowFulfillEvent('fs-root', 2)])
    expect(result.chapterPlan).not.toHaveProperty('foreshadowFulfillmentConflictIds')
  })

  it('routes structurally conflicting alias fulfillment events through plan compliance', async () => {
    const canonical = createRequiredForeshadow('fs-early', 3)
    const alias = { ...createRequiredForeshadow('fs-late', 3, 1), mergedInto: 'fs-early' }
    const scheduledState = stateWithScheduledForeshadows(2, '幕末既有大纲。', [canonical, alias])
    const outlineItem = {
      ...scheduledState.outline[2]!,
      fulfilledForeshadowIds: ['fs-late', 'fs-early'],
    }
    const conflictingPlan = createCompleteChapterPlan({
      chapterIndex: 2,
      fulfilledForeshadowIds: ['fs-late', 'fs-early'],
      expectedEvents: [
        { ...createForeshadowFulfillEvent('fs-late', 2), evidence: { paragraphIndex: 1 } },
        { ...createForeshadowFulfillEvent('fs-early', 2), evidence: { paragraphIndex: 2 } },
      ],
    })
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: conflictingPlan })

    await expect(
      expandOutlineForChapter(
        {
          ...scheduledState,
          outline: scheduledState.outline.map((item, index) => (index === 2 ? outlineItem : item)),
          chapterPlan: conflictingPlan,
        },
        2,
        createMockProvider()
      )
    ).rejects.toThrow('无法为本章必须回收的伏笔生成结构化证据：fs-early')
    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
  })

  it('discards beat claims invented by a newly generated plan', async () => {
    const locationEvent: StoryEvent = {
      id: 'evt-location',
      type: 'character-location',
      characterId: 'c-hero',
      locationId: 'l-hall',
      chapterIndex: 1,
      source: 'chapter',
    }
    const hallucinatedBeatEvent: StoryEvent = {
      id: 'evt-hallucinated-beat',
      type: 'plot-advance',
      plotId: 'act-2',
      beatId: 'A2-B3',
      chapterIndex: 1,
      source: 'chapter',
    }
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        claimedBeatIds: ['A2-B3'],
        expectedEvents: [locationEvent, hallucinatedBeatEvent],
      }),
    })

    const result = await expandOutlineForChapter(baseState, 1, createMockProvider())

    expect(result.outline?.[1]?.claimedBeatIds ?? []).toEqual([])
    expect(result.chapterPlan.claimedBeatIds).toEqual([])
    expect(result.chapterPlan.expectedEvents).toEqual([locationEvent])
  })

  it('discards stale beat claims when reusing a checkpoint plan', async () => {
    const stalePlan = createCompleteChapterPlan({
      claimedMandatoryBeatIds: ['A1-M1'],
      claimedBeatIds: ['A2-B3'],
      expectedEvents: [
        {
          id: 'evt-stale-beat',
          type: 'plot-advance',
          plotId: 'act-2',
          beatId: 'A2-B3',
          chapterIndex: 1,
          source: 'chapter',
        },
      ],
    })

    const result = await expandOutlineForChapter(
      {
        ...baseState,
        storyMemory: {
          ...createEmptyStoryMemory(),
          entities: {
            ...createEmptyStoryMemory().entities,
            plots: {
              'act-2': { id: 'act-2', name: 'Act 2', introducedIn: 0 },
            },
          },
          beats: {
            'A2-B3': {
              id: 'A2-B3',
              description: 'Stale beat',
              actIndex: 2,
              deadlineAct: 2,
              required: false,
              claimedIn: null,
              provenByEventIds: [],
            },
          },
        },
        chapterPlan: stalePlan,
      },
      1,
      createMockProvider()
    )

    expect(planChapterWithOverrideMock).not.toHaveBeenCalled()
    expect(result.chapterPlan.claimedMandatoryBeatIds).toEqual([])
    expect(result.chapterPlan.claimedBeatIds).toEqual([])
    expect(result.chapterPlan.expectedEvents).toEqual([])
  })

  it('replans a resumed chapter whose legacy event cannot be normalized safely', async () => {
    const legacyPlan = createCompleteChapterPlan({
      chapterIndex: 1,
      expectedEvents: [
        {
          id: 'evt-legacy-state',
          type: 'item-state',
          itemId: 'item-1',
          state: 'closed',
          chapterIndex: 1,
          source: 'chapter',
        } as unknown as StoryEvent,
      ],
    })
    const replacementPlan = createCompleteChapterPlan({
      chapterIndex: 1,
      expectedEvents: [
        {
          id: 'evt-replacement-state',
          type: 'item-state',
          itemId: 'item-1',
          attribute: 'sealed',
          value: true,
          chapterIndex: 1,
          source: 'chapter',
        },
      ],
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({ chapterPlan: replacementPlan })

    const result = await expandOutlineForChapter(
      { ...baseState, storyMemory: null, chapterPlan: legacyPlan },
      1,
      createMockProvider()
    )

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    expect(result.chapterPlan).toEqual(replacementPlan)
  })

  it('schedules a due foreshadow on an ordinary non-boundary chapter', async () => {
    const state = stateWithScheduledForeshadows(1, '', [
      {
        ...createRequiredForeshadow('fs-due', 2),
        resolutionQuestion: 'what remains unexplained?',
        fulfillmentCriteria: 'reveal the cause through an observable event',
      },
    ])
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '回收线索',
        description: '在核心事件内回收既有线索。',
        fulfilledForeshadowIds: ['fs-due'],
      },
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 1,
        fulfilledForeshadowIds: ['fs-due'],
        expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
      }),
    })

    const result = await expandOutlineForChapter(state, 1, createMockProvider())

    expect(result.outline?.[1]?.fulfilledForeshadowIds).toEqual(['fs-due'])
    expect(result.outline?.[1]?.deferredForeshadowIds).toEqual([])
    const jitInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      foreshadowObligations?: Array<{
        id: string
        text: string
        resolutionQuestion?: string
        fulfillmentCriteria?: string
        kind: string | null
        introducedChapter: number
        schedulingMode: string
      }>
    }
    expect(jitInput.foreshadowObligations).toEqual([
      expect.objectContaining({
        id: 'fs-due',
        text: 'structured clue fs-due',
        resolutionQuestion: 'what remains unexplained?',
        fulfillmentCriteria: 'reveal the cause through an observable event',
        kind: 'plot',
        introducedChapter: 0,
        schedulingMode: 'mandatory',
      }),
    ])
    const plannerInput = planChapterWithOverrideMock.mock.calls[0]![3] as {
      foreshadowObligations?: Array<{
        id: string
        text: string
        resolutionQuestion?: string
        fulfillmentCriteria?: string
        kind: string | null
        introducedChapter: number
      }>
    }
    expect(plannerInput.foreshadowObligations).toEqual([
      expect.objectContaining({
        id: 'fs-due',
        text: 'structured clue fs-due',
        resolutionQuestion: 'what remains unexplained?',
        fulfillmentCriteria: 'reveal the cause through an observable event',
        kind: 'plot',
        introducedChapter: 0,
      }),
    ])
  })

  it('passes without retry when every scheduled candidate is adjudicated', async () => {
    const state = stateWithScheduledForeshadows(1, '', [
      createRequiredForeshadow('fs-a', 2),
      createRequiredForeshadow('fs-b', 2),
    ])
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '部分回收',
        description: '本章自然回收其中一条线索，另一条与本章核心事件不相容，顺延处理。',
        fulfilledForeshadowIds: ['fs-a'],
        deferredForeshadowIds: ['fs-b'],
      },
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 1,
        fulfilledForeshadowIds: ['fs-a'],
        expectedEvents: [createForeshadowFulfillEvent('fs-a', 1)],
      }),
    })

    const result = await expandOutlineForChapter(state, 1, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    expect(result.outline?.[1]?.fulfilledForeshadowIds).toEqual(['fs-a'])
    expect(result.outline?.[1]?.deferredForeshadowIds).toEqual(['fs-b'])
    expect(result.chapterPlan.fulfilledForeshadowIds).toEqual(['fs-a'])
    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
    expect(formattedOutline).toContain('【本章伏笔调度候选】fs-a, fs-b')
    expect(formattedOutline).toContain('【本章兑现伏笔】fs-a')
    expect(formattedOutline).toContain('【本章顺延伏笔】fs-b')
  })

  it('offers an eligible null-deadline foreshadow as a natural recovery opportunity', async () => {
    const state = stateWithScheduledForeshadows(2, '', [
      createRequiredForeshadow('fs-natural', null),
    ])
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '顺势揭示',
        description: '本章核心事件自然揭示既有线索的真实含义。',
        fulfilledForeshadowIds: ['fs-natural'],
      },
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 2,
        fulfilledForeshadowIds: ['fs-natural'],
        expectedEvents: [createForeshadowFulfillEvent('fs-natural', 2)],
      }),
    })

    const result = await expandOutlineForChapter(state, 2, createMockProvider())

    expect(result.outline?.[2]?.fulfilledForeshadowIds).toEqual(['fs-natural'])
    const jitInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      foreshadowObligations?: Array<{
        id: string
        schedulingMode: string
        mustFulfillThisChapter: boolean
      }>
    }
    expect(jitInput.foreshadowObligations).toEqual([
      expect.objectContaining({
        id: 'fs-natural',
        schedulingMode: 'opportunity',
        mustFulfillThisChapter: false,
      }),
    ])
    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
    expect(formattedOutline).toContain('【本章自然回收候选】fs-natural')
    expect(formattedOutline).not.toContain('【本章伏笔调度候选】fs-natural')
  })

  it('auto-defers an omitted natural opportunity without retry or warning issue', async () => {
    const state = stateWithScheduledForeshadows(2, '', [
      createRequiredForeshadow('fs-natural', null),
    ])
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '暂不揭示',
        description: '本章核心事件尚不适合揭示既有线索。',
        fulfilledForeshadowIds: [],
      },
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({ chapterIndex: 2 }),
    })

    const result = await expandOutlineForChapter(state, 2, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    expect(result.outline?.[2]?.fulfilledForeshadowIds).toEqual([])
    expect(result.outline?.[2]?.deferredForeshadowIds).toEqual(['fs-natural'])
    expect(result.pendingIssues.some((issue) => issue.type === 'outline_foreshadow')).toBe(false)
  })

  it('treats eleven should_resolve clues as bounded opportunities at chapter 58', async () => {
    const foreshadows = Array.from({ length: 11 }, (_, index) =>
      createRequiredForeshadow(`fs-soft-${index + 1}`, null)
    )
    const outline = Array.from({ length: 61 }, (_, index) => ({
      number: index + 1,
      title: `第 ${index + 1} 章`,
      description: index === 57 ? '' : '既有大纲。',
    }))
    const state: ReducedGraphState = {
      ...baseState,
      currentChapterIndex: 57,
      totalChapters: 61,
      story: { ...baseState.story, totalChapters: 61 },
      storyArc: {
        totalChapters: 61,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 55,
            title: '前四幕',
            theme: '展开',
            function: '展开故事',
            mandatoryBeats: [],
          },
          {
            index: 2,
            startChapter: 56,
            endChapter: 61,
            title: '最终幕',
            theme: '收束',
            function: '完成结局',
            mandatoryBeats: [],
          },
        ],
        keyBeats: [],
      },
      outline,
      actProgress: {
        1: { consumed: [], pending: [] },
        2: { consumed: [], pending: [] },
      },
      chapters: Array.from({ length: 61 }, () => null),
      storyMemory: {
        ...createEmptyStoryMemory(),
        foreshadows: Object.fromEntries(
          foreshadows.map((foreshadow) => [foreshadow.id, foreshadow])
        ),
      },
    }
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({ chapterIndex: 57 }),
    })

    const result = await expandOutlineForChapter(state, 57, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    const input = chapterOutlineRunMock.mock.calls[0]![0] as {
      foreshadowObligations?: Array<{
        resolutionPolicy: string
        schedulingMode: string
        mustFulfillThisChapter: boolean
      }>
    }
    expect(input.foreshadowObligations).toHaveLength(1)
    expect(input.foreshadowObligations).toEqual([
      expect.objectContaining({
        resolutionPolicy: 'should_resolve',
        schedulingMode: 'opportunity',
        mustFulfillThisChapter: false,
      }),
    ])
    expect(result.storyArc?.acts[1]?.endChapter).toBe(61)
    expect(result.totalChapters).toBe(61)
  })

  it('ignores the current chapter stale deferral when rotating natural opportunities on rewrite', async () => {
    const scheduledState = stateWithScheduledForeshadows(2, '既有大纲。', [
      createRequiredForeshadow('fs-a', null),
      createRequiredForeshadow('fs-b', null),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) => {
        if (index === 0) return { ...item, deferredForeshadowIds: ['fs-a'] }
        if (index === 2) return { ...item, deferredForeshadowIds: ['fs-b'] }
        return item
      }),
    }
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({ chapterIndex: 2 }),
    })

    await expandOutlineForChapter(state, 2, createMockProvider())

    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
    expect(formattedOutline).toContain('【本章自然回收候选】fs-b')
    expect(formattedOutline).not.toContain('【本章自然回收候选】fs-a')
  })

  it('requires the minimum share when pending foreshadows exceed future target capacity', async () => {
    // 第 2 章（幕结束于第 3 章，剩余 2 章），4 个待回收伏笔 - 后续 1 章 × 2 目标容量 = 本章至少 2 个
    const foreshadowIds = ['fs-a', 'fs-b', 'fs-c', 'fs-d']
    const state = stateWithScheduledForeshadows(
      1,
      '',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 2))
    )
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '强制回收',
        description: '本章在核心事件中回收调度到的线索。',
        fulfilledForeshadowIds: ['fs-a', 'fs-b'],
        deferredForeshadowIds: ['fs-c'],
      },
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 1,
        fulfilledForeshadowIds: ['fs-a', 'fs-b'],
        expectedEvents: ['fs-a', 'fs-b'].map((id) => createForeshadowFulfillEvent(id, 1)),
      }),
    })

    const result = await expandOutlineForChapter(state, 1, createMockProvider())

    expect(result.outline?.[1]?.fulfilledForeshadowIds).toEqual(['fs-a', 'fs-b'])
    const jitInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      foreshadowObligations?: Array<{ id: string; mustFulfillThisChapter: boolean }>
    }
    expect(jitInput.foreshadowObligations).toEqual([
      expect.objectContaining({ id: 'fs-a', mustFulfillThisChapter: true }),
      expect.objectContaining({ id: 'fs-b', mustFulfillThisChapter: true }),
      expect.objectContaining({ id: 'fs-c', mustFulfillThisChapter: false }),
    ])
  })

  it('reserves final-chapter foreshadow headroom without extending the act', async () => {
    const foreshadowIds = ['fs-a', 'fs-b', 'fs-c']
    const state = stateWithScheduledForeshadows(
      1,
      '',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 2))
    )
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '提前分担',
        description: '本章先回收一条线索，为幕末规划保留余量。',
        fulfilledForeshadowIds: ['fs-a'],
        deferredForeshadowIds: ['fs-b', 'fs-c'],
      },
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 1,
        fulfilledForeshadowIds: ['fs-a'],
        expectedEvents: [createForeshadowFulfillEvent('fs-a', 1)],
      }),
    })

    const result = await expandOutlineForChapter(state, 1, createMockProvider())

    const jitInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      foreshadowObligations?: Array<{ id: string; mustFulfillThisChapter: boolean }>
    }
    expect(jitInput.foreshadowObligations).toEqual([
      expect.objectContaining({ id: 'fs-a', mustFulfillThisChapter: true }),
      expect.objectContaining({ id: 'fs-b', mustFulfillThisChapter: false }),
      expect.objectContaining({ id: 'fs-c', mustFulfillThisChapter: false }),
    ])
    expect(result.storyArc?.acts.map((act) => [act.startChapter, act.endChapter])).toEqual([
      [1, 3],
      [4, 4],
    ])
  })

  it('stays in advisory mode when remaining capacity can hold pending foreshadows', async () => {
    // 第 2 章（剩余 2 章），2 个待回收伏笔 ≤ 后续 1 章 × 3 容量 → 非 tight
    const state = stateWithScheduledForeshadows(1, '', [
      createRequiredForeshadow('fs-a', 2),
      createRequiredForeshadow('fs-b', 2),
    ])
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '部分回收',
        description: '本章自然回收其中一条线索。',
        fulfilledForeshadowIds: ['fs-a'],
        deferredForeshadowIds: ['fs-b'],
      },
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 1,
        fulfilledForeshadowIds: ['fs-a'],
        expectedEvents: [createForeshadowFulfillEvent('fs-a', 1)],
      }),
    })

    await expandOutlineForChapter(state, 1, createMockProvider())

    const jitInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      foreshadowObligations?: Array<{ id: string; mustFulfillThisChapter: boolean }>
    }
    expect(jitInput.foreshadowObligations).toEqual([
      expect.objectContaining({ id: 'fs-a', mustFulfillThisChapter: false }),
      expect.objectContaining({ id: 'fs-b', mustFulfillThisChapter: false }),
    ])
  })

  it('rejects mandatory deferral after one structured correction', async () => {
    const foreshadowIds = ['fs-a', 'fs-b', 'fs-c']
    const state = stateWithScheduledForeshadows(
      2,
      '',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 3))
    )
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '幕末核心事件',
        description: '本章完成幕末核心事件，并将不相容的既有线索顺延。',
        fulfilledForeshadowIds: [],
        deferredForeshadowIds: foreshadowIds,
      },
    })
    planChapterWithOverrideMock.mockResolvedValue({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 2,
        fulfilledForeshadowIds: [],
        expectedEvents: [],
      }),
    })

    await expect(expandOutlineForChapter(state, 2, createMockProvider())).rejects.toThrow(
      '第 3 章伏笔大纲修订未收敛：必须回收 fs-a, fs-b, fs-c；最终未裁决或错误顺延 fs-a, fs-b, fs-c；修订中回退 无'
    )

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(3)
    const correction = chapterOutlineRunMock.mock.calls[1]![0] as {
      foreshadowPlanningRejection?: {
        incorrectlyDeferredIds: string[]
      }
    }
    expect(correction.foreshadowPlanningRejection?.incorrectlyDeferredIds).toEqual(foreshadowIds)
    expect(planChapterWithOverrideMock).not.toHaveBeenCalled()
  })

  it('reports non-regressing mandatory revision when retries trade one omission for another', async () => {
    const foreshadowIds = ['fs-a', 'fs-b', 'fs-c']
    const state = stateWithScheduledForeshadows(
      2,
      '',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 3))
    )
    chapterOutlineRunMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '第一版修订',
          description: '第一版保留后两条回收事件，但遗漏第一条。',
          fulfilledForeshadowIds: ['fs-b', 'fs-c'],
          deferredForeshadowIds: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '第二版修订',
          description: '第二版补上第一条，却丢失后两条。',
          fulfilledForeshadowIds: ['fs-a'],
          deferredForeshadowIds: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '第三版修订',
          description: '第三版仍只保留第一条，后两条继续遗漏。',
          fulfilledForeshadowIds: ['fs-a'],
          deferredForeshadowIds: [],
        },
      })

    await expect(expandOutlineForChapter(state, 2, createMockProvider())).rejects.toThrow(
      /第 3 章伏笔大纲修订未收敛：必须回收 fs-a, fs-b, fs-c；最终未裁决或错误顺延 fs-b, fs-c；修订中回退 fs-b, fs-c/
    )

    const secondInput = chapterOutlineRunMock.mock.calls[1]![0] as {
      foreshadowPlanningRejection?: {
        requiredFulfillmentIds?: string[]
        preservedFulfillmentIds?: string[]
        currentOutline?: { title: string; description: string }
      }
    }
    expect(secondInput.foreshadowPlanningRejection).toMatchObject({
      requiredFulfillmentIds: foreshadowIds,
      preservedFulfillmentIds: ['fs-b', 'fs-c'],
      currentOutline: {
        title: '第一版修订',
        description: '第一版保留后两条回收事件，但遗漏第一条。',
      },
    })
  })

  it('fulfills a tight mandatory batch on the single correction attempt', async () => {
    const foreshadowIds = ['fs-a', 'fs-b', 'fs-c']
    const base = stateWithScheduledForeshadows(
      2,
      '',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 3))
    )
    const state: ReducedGraphState = {
      ...base,
      storyArc: {
        ...base.storyArc!,
        acts: [
          {
            ...base.storyArc!.acts[0]!,
            endChapter: 3,
            autoBoundaryAdjustment: {
              originalEndChapter: 0,
              totalExtendedChapters: 3,
            },
          },
          base.storyArc!.acts[1]!,
        ],
      },
    }
    chapterOutlineRunMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '顺延尝试',
          description: '本章尝试顺延处理不相容线索。',
          fulfilledForeshadowIds: [],
          deferredForeshadowIds: foreshadowIds,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '强制回收',
          description: '本章在幕末强制回收全部既有线索。',
          fulfilledForeshadowIds: foreshadowIds,
          deferredForeshadowIds: [],
        },
      })
    planChapterWithOverrideMock.mockResolvedValue({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 2,
        fulfilledForeshadowIds: foreshadowIds,
        expectedEvents: foreshadowIds.map((id) => createForeshadowFulfillEvent(id, 2)),
      }),
    })

    const result = await expandOutlineForChapter(state, 2, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(2)
    expect(
      (
        chapterOutlineRunMock.mock.calls[1]![0] as {
          foreshadowPlanningRejection?: { incorrectlyDeferredIds: string[] }
        }
      ).foreshadowPlanningRejection?.incorrectlyDeferredIds
    ).toEqual(foreshadowIds)
    expect(result.outline?.[2]?.fulfilledForeshadowIds).toEqual(foreshadowIds)
    expect(result.outline?.[2]?.deferredForeshadowIds).toEqual([])
    expect(result.storyArc?.acts.map((act) => [act.startChapter, act.endChapter])).toEqual([
      [1, 3],
      [4, 4],
    ])
    expect(result.totalChapters).toBe(4)
  })

  it('fulfills mandatory foreshadows in the last chapter without extending the act', async () => {
    const foreshadowIds = ['fs-a', 'fs-b', 'fs-c']
    const state = stateWithScheduledForeshadows(
      2,
      '',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 3))
    )
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '幕末核心事件',
        description: '本章完成幕末核心事件，并自然回收全部既有线索。',
        fulfilledForeshadowIds: foreshadowIds,
        deferredForeshadowIds: [],
      },
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 2,
        fulfilledForeshadowIds: foreshadowIds,
        expectedEvents: foreshadowIds.map((id) => createForeshadowFulfillEvent(id, 2)),
      }),
    })

    const result = await expandOutlineForChapter(state, 2, createMockProvider())

    expect(result.storyArc?.acts.map((act) => [act.startChapter, act.endChapter])).toEqual([
      [1, 3],
      [4, 4],
    ])
    expect(result.totalChapters).toBe(4)
    expect(result.outline?.[2]?.fulfilledForeshadowIds).toEqual(foreshadowIds)
    expect(result.outline?.[2]?.deferredForeshadowIds).toEqual([])
  })

  it('rejects missing planner evidence for must-fulfill obligations after one correction', async () => {
    const foreshadowIds = ['fs-a', 'fs-b', 'fs-c']
    const state = stateWithScheduledForeshadows(
      2,
      '',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 3))
    )
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '计划回收',
        description: '本章尝试在核心事件中回收既有线索。',
        fulfilledForeshadowIds: foreshadowIds,
        deferredForeshadowIds: [],
      },
    })
    planChapterWithOverrideMock.mockResolvedValue({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 2,
        fulfilledForeshadowIds: foreshadowIds,
        expectedEvents: [],
      }),
    })

    await expect(expandOutlineForChapter(state, 2, createMockProvider())).rejects.toThrow(
      '第 3 章章节规划无法为本章必须回收的伏笔生成结构化证据：fs-a, fs-b, fs-c'
    )

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(2)
    expect(planChapterWithOverrideMock.mock.calls[1]![3]).toEqual(
      expect.objectContaining({
        foreshadowPlanningRejection: {
          missingDeclarationIds: [],
          missingEventIds: foreshadowIds,
          incorrectlyDeferredIds: [],
        },
      })
    )
  })

  it('retries JIT outline generation when a scheduled obligation is omitted', async () => {
    chapterOutlineRunMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '遗漏版本',
          description: '没有安排伏笔回收。',
          fulfilledForeshadowIds: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '修正版',
          description: '在核心事件内完成既有线索回收。',
          fulfilledForeshadowIds: ['fs-due'],
        },
      })
    planChapterWithOverrideMock.mockResolvedValue({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 2,
        fulfilledForeshadowIds: ['fs-due'],
        expectedEvents: [createForeshadowFulfillEvent('fs-due', 2)],
      }),
    })

    const result = await expandOutlineForChapter(
      stateWithScheduledForeshadows(2, '', [createRequiredForeshadow('fs-due', 3)]),
      2,
      createMockProvider()
    )

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(2)
    expect(result.outline?.[2]?.fulfilledForeshadowIds).toEqual(['fs-due'])
    const retryInput = chapterOutlineRunMock.mock.calls[1]![0] as {
      foreshadowPlanningRejection?: {
        missingDeclarationIds: string[]
        missingEventIds: string[]
        incorrectlyDeferredIds: string[]
      }
    }
    expect(retryInput.foreshadowPlanningRejection).toMatchObject({
      missingDeclarationIds: ['fs-due'],
      missingEventIds: [],
      incorrectlyDeferredIds: [],
      requiredFulfillmentIds: ['fs-due'],
      preservedFulfillmentIds: [],
      currentOutline: {
        title: '遗漏版本',
        description: '没有安排伏笔回收。',
      },
    })
  })

  it('passes bounded scheduled IDs to planning when an outline already exists', async () => {
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [
      createRequiredForeshadow('fs-a', 2),
      createRequiredForeshadow('fs-b', 2),
      createRequiredForeshadow('fs-c', 2),
      createRequiredForeshadow('fs-d', 2),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 1 ? { ...item, fulfilledForeshadowIds: ['fs-d'] } : item
      ),
    }
    planChapterWithOverrideMock.mockResolvedValue({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 1,
        fulfilledForeshadowIds: ['fs-d'],
        expectedEvents: [createForeshadowFulfillEvent('fs-d', 1)],
      }),
    })

    await expandOutlineForChapter(state, 1, createMockProvider())

    expect(chapterOutlineRunMock).not.toHaveBeenCalled()
    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
    const planningInput = planChapterWithOverrideMock.mock.calls[0]![3] as {
      foreshadowObligations?: Array<{ id: string; schedulingMode: string }>
    }
    expect(formattedOutline).toContain('【本章伏笔调度候选】fs-a, fs-b, fs-c')
    expect(formattedOutline).toContain('【本章兑现伏笔】fs-d')
    expect(planningInput.foreshadowObligations).toEqual([
      expect.objectContaining({ id: 'fs-a', schedulingMode: 'mandatory' }),
      expect.objectContaining({ id: 'fs-b', schedulingMode: 'mandatory' }),
      expect.objectContaining({ id: 'fs-c', schedulingMode: 'mandatory' }),
    ])
  })

  it('excludes unscheduled clues in an ordinary act and includes future/null clues in the final act', async () => {
    const ordinaryState = stateWithScheduledForeshadows(1, '既有大纲。', [
      createRequiredForeshadow('fs-due', 2),
      createRequiredForeshadow('fs-future', 4),
      createRequiredForeshadow('fs-null', null),
    ])
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 1,
        fulfilledForeshadowIds: ['fs-due'],
        expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
      }),
    })

    await expandOutlineForChapter(ordinaryState, 1, createMockProvider())

    const ordinaryOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
    expect(ordinaryOutline).toContain('fs-due')
    expect(ordinaryOutline).not.toContain('fs-future')
    expect(ordinaryOutline).not.toContain('fs-null')

    const finalActState = stateWithScheduledForeshadows(3, '终幕既有大纲。', [
      createRequiredForeshadow('fs-future', 6),
      createRequiredForeshadow('fs-null', null),
    ])
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 3,
        fulfilledForeshadowIds: ['fs-future', 'fs-null'],
        expectedEvents: ['fs-future', 'fs-null'].map((id) => createForeshadowFulfillEvent(id, 3)),
      }),
    })

    await expandOutlineForChapter(finalActState, 3, createMockProvider())

    const finalOutline = planChapterWithOverrideMock.mock.calls[1]![2] as string
    expect(finalOutline).toContain('fs-future')
    expect(finalOutline).toContain('fs-null')
  })

  it('auto-defers scheduled foreshadow IDs when all JIT attempts omit them', async () => {
    const state = stateWithScheduledForeshadows(1, '', [createRequiredForeshadow('fs-due', 2)])
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '遗漏版本',
        description: '没有声明线索回收。',
        fulfilledForeshadowIds: [],
      },
    })

    try {
      const result = await expandOutlineForChapter(state, 1, createMockProvider())

      expect(chapterOutlineRunMock).toHaveBeenCalledTimes(3)
      expect(warnSpy).toHaveBeenCalledWith(
        '[MuseFlow] 第 2 章即时大纲第 1/3 次存在未裁决或错误顺延伏笔候选：fs-due'
      )
      expect(warnSpy).toHaveBeenCalledWith(
        '[MuseFlow] 第 2 章即时大纲第 2/3 次存在未裁决或错误顺延伏笔候选：fs-due'
      )
      expect(warnSpy).toHaveBeenCalledWith(
        '[MuseFlow] 第 2 章即时大纲第 3/3 次存在未裁决或错误顺延伏笔候选：fs-due'
      )
      expect(result.outline?.[1]?.deferredForeshadowIds).toContain('fs-due')
      expect(result.outline?.[1]?.fulfilledForeshadowIds).not.toContain('fs-due')
      expect(result.pendingIssues.some((i) => i.type === 'outline_foreshadow')).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('replans when a declaration is present but its expected event is missing', async () => {
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [
      createRequiredForeshadow('fs-due', 2),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 1 ? { ...item, fulfilledForeshadowIds: ['fs-due'] } : item
      ),
    }
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    try {
      planChapterWithOverrideMock
        .mockResolvedValueOnce({
          chapterPlan: createCompleteChapterPlan({
            chapterIndex: 1,
            fulfilledForeshadowIds: ['fs-due'],
          }),
        })
        .mockResolvedValueOnce({
          chapterPlan: createCompleteChapterPlan({
            chapterIndex: 1,
            fulfilledForeshadowIds: ['fs-due'],
            expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
          }),
        })

      const result = await expandOutlineForChapter(state, 1, createMockProvider())

      expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(2)
      expect(result.chapterPlan.expectedEvents).toEqual([createForeshadowFulfillEvent('fs-due', 1)])
      expect(warnSpy).toHaveBeenCalledWith(
        '[MuseFlow] 第 2 章章节规划第 1/2 次遗漏大纲声称的伏笔兑现证据：fulfilledForeshadowIds：（无遗漏）；expectedEvents.foreshadow-fulfill：fs-due（单章容量 3）'
      )
      const correctionState = planChapterWithOverrideMock.mock.calls[1]![1] as ReducedGraphState
      const correctionText = correctionState.verifiedConstraints
        ?.map((item) => item.text)
        .join('\n')
      expect(correctionText).toContain('expectedEvents')
      expect(correctionText).toContain('fs-due')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('auto-defers outline-claimed foreshadow IDs when plan correction is exhausted', async () => {
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [
      createRequiredForeshadow('fs-due', 2),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 1 ? { ...item, fulfilledForeshadowIds: ['fs-due'] } : item
      ),
    }
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    planChapterWithOverrideMock
      .mockResolvedValueOnce({
        chapterPlan: createCompleteChapterPlan({
          chapterIndex: 1,
          fulfilledForeshadowIds: ['fs-due'],
        }),
      })
      .mockResolvedValueOnce({
        chapterPlan: createCompleteChapterPlan({
          chapterIndex: 1,
          expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
        }),
      })

    try {
      const result = await expandOutlineForChapter(state, 1, createMockProvider())

      expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(2)
      expect(warnSpy).toHaveBeenCalledWith(
        '[MuseFlow] 第 2 章章节规划第 2/2 次遗漏大纲声称的伏笔兑现证据：fulfilledForeshadowIds：fs-due；expectedEvents.foreshadow-fulfill：（无遗漏）（单章容量 3）'
      )
      expect(result.outline?.[1]?.deferredForeshadowIds).toContain('fs-due')
      expect(result.outline?.[1]?.fulfilledForeshadowIds).not.toContain('fs-due')
      expect(result.chapterPlan.fulfilledForeshadowIds).not.toContain('fs-due')
      expect(result.chapterPlan.expectedEvents).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ foreshadowId: 'fs-due' })])
      )
      expect(result.pendingIssues.some((i) => i.type === 'outline_foreshadow')).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('silently defers a natural opportunity when planner evidence correction is exhausted', async () => {
    const scheduledState = stateWithScheduledForeshadows(2, '既有大纲。', [
      createRequiredForeshadow('fs-natural', null),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 2 ? { ...item, fulfilledForeshadowIds: ['fs-natural'] } : item
      ),
    }
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    planChapterWithOverrideMock
      .mockResolvedValueOnce({
        chapterPlan: createCompleteChapterPlan({
          chapterIndex: 2,
          fulfilledForeshadowIds: ['fs-natural'],
        }),
      })
      .mockResolvedValueOnce({
        chapterPlan: createCompleteChapterPlan({
          chapterIndex: 2,
          expectedEvents: [createForeshadowFulfillEvent('fs-natural', 2)],
        }),
      })

    try {
      const result = await expandOutlineForChapter(state, 2, createMockProvider())

      expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(2)
      expect(result.outline?.[2]?.deferredForeshadowIds).toContain('fs-natural')
      expect(result.outline?.[2]?.fulfilledForeshadowIds).not.toContain('fs-natural')
      expect(result.chapterPlan.fulfilledForeshadowIds).not.toContain('fs-natural')
      expect(result.pendingIssues.some((issue) => issue.type === 'outline_foreshadow')).toBe(false)
      expect(result.storyArc?.acts.map((act) => act.endChapter)).toEqual([3, 4])
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('自然回收机会 fs-natural 未形成完整规划证据，已无损顺延')
      )
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('fs-natural 未形成完整规划证据')
      )
    } finally {
      infoSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  it('defers a non-mandatory semantic rejection and removes every fulfillment claim', async () => {
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [
      createRequiredForeshadow('fs-due', 3),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 1 ? { ...item, fulfilledForeshadowIds: ['fs-due'] } : item
      ),
    }
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 1,
        fulfilledForeshadowIds: ['fs-due'],
        expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
      }),
    })
    verifyForeshadowPlanMock.mockResolvedValue([
      {
        foreshadowId: 'fs-due',
        verdict: 'not_fulfilled',
        reason: '规划动作没有消解原伏笔的不确定性。',
        mandatory: false,
      },
    ])

    const result = await expandOutlineForChapter(state, 1, createMockProvider())

    expect(result.outline?.[1]?.fulfilledForeshadowIds).toEqual([])
    expect(result.outline?.[1]?.deferredForeshadowIds).toContain('fs-due')
    expect(result.chapterPlan.fulfilledForeshadowIds).toEqual([])
    expect(result.chapterPlan.expectedEvents).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ foreshadowId: 'fs-due' })])
    )
  })

  it('revises an existing outline and regenerates its plan after a mandatory semantic rejection', async () => {
    const scheduledState = stateWithScheduledForeshadows(2, '灯没有亮，却声明回收旧线索。', [
      createRequiredForeshadow('fs-hard', 3),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 2 ? { ...item, fulfilledForeshadowIds: ['fs-hard'] } : item
      ),
    }
    const originalPlan = createCompleteChapterPlan({
      chapterIndex: 2,
      sections: [
        {
          title: '错误回收',
          summary: '灯没有亮。',
          wordCount: 3000,
          events: ['声明回收'],
          characters: ['主角'],
        },
      ],
      fulfilledForeshadowIds: ['fs-hard'],
      expectedEvents: [createForeshadowFulfillEvent('fs-hard', 2)],
    })
    const revisedPlan = createCompleteChapterPlan({
      chapterIndex: 2,
      sections: [
        {
          title: '真实揭示',
          summary: '通过核心事件揭示灯持续发亮的原因。',
          wordCount: 3000,
          events: ['消解既有不确定性'],
          characters: ['主角'],
        },
      ],
      fulfilledForeshadowIds: ['fs-hard'],
      expectedEvents: [createForeshadowFulfillEvent('fs-hard', 2)],
    })
    planChapterWithOverrideMock
      .mockResolvedValueOnce({ chapterPlan: originalPlan })
      .mockResolvedValue({ chapterPlan: revisedPlan })
    let semanticVerificationAttempt = 0
    verifyForeshadowPlanMock.mockImplementation(() => {
      semanticVerificationAttempt++
      return Promise.resolve(
        semanticVerificationAttempt === 1
          ? [
              {
                foreshadowId: 'fs-hard',
                verdict: 'not_fulfilled',
                reason: '规划明确否定了原伏笔建立的事实。',
                mandatory: true,
              },
            ]
          : [
              {
                foreshadowId: 'fs-hard',
                verdict: 'fulfilled',
                reason: '修订规划给出了可执行的真实解释。',
                mandatory: true,
              },
            ]
      )
    })
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '真实回收',
        description: '本章通过核心事件揭示灯持续发亮的原因。',
        fulfilledForeshadowIds: ['fs-hard'],
        deferredForeshadowIds: [],
      },
    })

    const result = await expandOutlineForChapter(state, 2, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    const revisionInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      foreshadowPlanningRejection?: {
        currentOutline?: { title: string; description: string }
        semanticRejections?: Array<{ foreshadowId: string; reason: string }>
      }
    }
    expect(revisionInput.foreshadowPlanningRejection).toMatchObject({
      currentOutline: {
        title: '第三章',
        description: '灯没有亮，却声明回收旧线索。',
      },
      semanticRejections: [
        {
          foreshadowId: 'fs-hard',
          reason: '规划明确否定了原伏笔建立的事实。',
        },
      ],
    })
    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(2)
    const retryPlanningInput = planChapterWithOverrideMock.mock.calls[1]![3] as {
      foreshadowPlanningRejection?: { semanticRejections?: Array<{ foreshadowId: string }> }
    }
    expect(retryPlanningInput.foreshadowPlanningRejection?.semanticRejections).toEqual([
      expect.objectContaining({ foreshadowId: 'fs-hard' }),
    ])
    expect(result.outline?.[2]?.title).toBe('真实回收')
    expect(result.chapterPlan.sections[0]?.title).toBe('真实揭示')
  })

  it('preserves mandatory semantic successes while revising the remaining failures', async () => {
    const foreshadowIds = ['fs-preserved', 'fs-rejected-a', 'fs-rejected-b']
    const scheduledState = stateWithScheduledForeshadows(
      2,
      '第一版大纲同时安排三条伏笔回收。',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 3))
    )
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 2 ? { ...item, fulfilledForeshadowIds: foreshadowIds } : item
      ),
    }
    const completePlan = createCompleteChapterPlan({
      chapterIndex: 2,
      fulfilledForeshadowIds: foreshadowIds,
      expectedEvents: foreshadowIds.map((id) => createForeshadowFulfillEvent(id, 2)),
    })
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: completePlan })

    verifyForeshadowPlanMock
      .mockResolvedValueOnce([
        {
          foreshadowId: 'fs-preserved',
          verdict: 'fulfilled',
          reason: '第一条已经形成可验证回收。',
          mandatory: true,
        },
        {
          foreshadowId: 'fs-rejected-a',
          verdict: 'not_fulfilled',
          reason: '第二条尚未消解不确定性。',
          mandatory: true,
        },
        {
          foreshadowId: 'fs-rejected-b',
          verdict: 'uncertain',
          reason: '第三条缺少可执行证据。',
          mandatory: true,
        },
      ])
      .mockResolvedValueOnce(
        foreshadowIds.map((foreshadowId) => ({
          foreshadowId,
          verdict: 'fulfilled' as const,
          reason: '修订后形成可验证回收。',
          mandatory: true,
        }))
      )
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '单调修订',
        description: '保留第一条回收事件，并补齐另外两条。',
        fulfilledForeshadowIds: foreshadowIds,
        deferredForeshadowIds: [],
      },
    })

    await expandOutlineForChapter(state, 2, createMockProvider())

    const revisionInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      foreshadowPlanningRejection?: {
        requiredFulfillmentIds?: string[]
        preservedFulfillmentIds?: string[]
        regressedFulfillmentIds?: string[]
      }
    }
    expect(revisionInput.foreshadowPlanningRejection).toMatchObject({
      requiredFulfillmentIds: foreshadowIds,
      preservedFulfillmentIds: ['fs-preserved'],
      regressedFulfillmentIds: [],
    })
  })

  it('continues semantic revision while the mandatory rejection set strictly shrinks', async () => {
    const foreshadowIds = ['fs-progress-a', 'fs-progress-b', 'fs-progress-c']
    const scheduledState = stateWithScheduledForeshadows(
      2,
      '第一版大纲声明三条伏笔回收。',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 3))
    )
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 2 ? { ...item, fulfilledForeshadowIds: foreshadowIds } : item
      ),
    }
    planChapterWithOverrideMock.mockResolvedValue({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 2,
        fulfilledForeshadowIds: foreshadowIds,
        expectedEvents: foreshadowIds.map((id) => createForeshadowFulfillEvent(id, 2)),
      }),
    })

    verifyForeshadowPlanMock
      .mockResolvedValueOnce(
        foreshadowIds.map((foreshadowId) => ({
          foreshadowId,
          verdict: 'not_fulfilled' as const,
          reason: '第一版尚未形成真实回收。',
          mandatory: true,
        }))
      )
      .mockResolvedValueOnce([
        {
          foreshadowId: 'fs-progress-a',
          verdict: 'fulfilled',
          reason: '第一条已经形成真实回收。',
          mandatory: true,
        },
        {
          foreshadowId: 'fs-progress-b',
          verdict: 'fulfilled',
          reason: '第二条已经形成真实回收。',
          mandatory: true,
        },
        {
          foreshadowId: 'fs-progress-c',
          verdict: 'not_fulfilled',
          reason: '第三条仍缺少决定性揭示。',
          mandatory: true,
        },
      ])
      .mockResolvedValueOnce(
        foreshadowIds.map((foreshadowId) => ({
          foreshadowId,
          verdict: 'fulfilled' as const,
          reason: '最终修订形成真实回收。',
          mandatory: true,
        }))
      )
    chapterOutlineRunMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '部分收敛',
          description: '第二版解决前两条，但第三条仍需补强。',
          fulfilledForeshadowIds: foreshadowIds,
          deferredForeshadowIds: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '全部收敛',
          description: '第三版保留前两条回收，并补齐最后一条。',
          fulfilledForeshadowIds: foreshadowIds,
          deferredForeshadowIds: [],
        },
      })

    const result = await expandOutlineForChapter(state, 2, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(2)
    const finalRevisionInput = chapterOutlineRunMock.mock.calls[1]![0] as {
      foreshadowPlanningRejection?: {
        requiredFulfillmentIds?: string[]
        preservedFulfillmentIds?: string[]
        semanticRejections?: Array<{ foreshadowId: string }>
      }
    }
    expect(finalRevisionInput.foreshadowPlanningRejection).toMatchObject({
      requiredFulfillmentIds: foreshadowIds,
      preservedFulfillmentIds: ['fs-progress-a', 'fs-progress-b'],
      semanticRejections: [{ foreshadowId: 'fs-progress-c' }],
    })
    expect(result.outline?.[2]?.title).toBe('全部收敛')
  })

  it('feeds an updated semantic rejection back when the unresolved ID is unchanged', async () => {
    const scheduledState = stateWithScheduledForeshadows(2, '第一版大纲错误兑现既有线索。', [
      createRequiredForeshadow('fs-feedback', 3),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 2 ? { ...item, fulfilledForeshadowIds: ['fs-feedback'] } : item
      ),
    }
    planChapterWithOverrideMock.mockResolvedValue({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 2,
        fulfilledForeshadowIds: ['fs-feedback'],
        expectedEvents: [createForeshadowFulfillEvent('fs-feedback', 2)],
      }),
    })
    verifyForeshadowPlanMock
      .mockResolvedValueOnce([
        {
          foreshadowId: 'fs-feedback',
          verdict: 'not_fulfilled',
          reason: '第一版只重复了原始现象。',
          mandatory: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          foreshadowId: 'fs-feedback',
          verdict: 'not_fulfilled',
          reason: '第二版新增了动作，但仍未回答原有因果疑问。',
          mandatory: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          foreshadowId: 'fs-feedback',
          verdict: 'fulfilled',
          reason: '第三版通过可验证事件消解了原有疑问。',
          mandatory: true,
        },
      ])
    chapterOutlineRunMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '仍未兑现',
          description: '第二版增加相关动作，但尚未完成因果闭环。',
          fulfilledForeshadowIds: ['fs-feedback'],
          deferredForeshadowIds: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '完成兑现',
          description: '第三版根据最新审校意见补齐可验证的因果闭环。',
          fulfilledForeshadowIds: ['fs-feedback'],
          deferredForeshadowIds: [],
        },
      })

    const result = await expandOutlineForChapter(state, 2, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(2)
    const finalRevisionInput = chapterOutlineRunMock.mock.calls[1]![0] as {
      foreshadowPlanningRejection?: {
        semanticRejections?: Array<{ foreshadowId: string; reason: string }>
      }
    }
    expect(finalRevisionInput.foreshadowPlanningRejection?.semanticRejections).toEqual([
      {
        foreshadowId: 'fs-feedback',
        verdict: 'not_fulfilled',
        reason: '第二版新增了动作，但仍未回答原有因果疑问。',
      },
    ])
    expect(result.outline?.[2]?.title).toBe('完成兑现')
  })

  it('stops before drafting when a mandatory semantic rejection persists after revision', async () => {
    const scheduledState = stateWithScheduledForeshadows(2, '既有但错误的大纲。', [
      createRequiredForeshadow('fs-hard', 3),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 2 ? { ...item, fulfilledForeshadowIds: ['fs-hard'] } : item
      ),
    }
    const invalidPlan = createCompleteChapterPlan({
      chapterIndex: 2,
      fulfilledForeshadowIds: ['fs-hard'],
      expectedEvents: [createForeshadowFulfillEvent('fs-hard', 2)],
    })
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: invalidPlan })
    verifyForeshadowPlanMock.mockResolvedValue([
      {
        foreshadowId: 'fs-hard',
        verdict: 'uncertain',
        reason: '规划始终没有足够细节。',
        mandatory: true,
      },
    ])
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '仍然含糊',
        description: '修订后仍未说明如何消解线索。',
        fulfilledForeshadowIds: ['fs-hard'],
        deferredForeshadowIds: [],
      },
    })

    await expect(expandOutlineForChapter(state, 2, createMockProvider())).rejects.toThrow(
      '第 3 章伏笔语义规划连续 3 次未通过：fs-hard'
    )
    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(2)
    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(3)
  })

  it('extends a boundary by three chapters for eleven due IDs and schedules only the first three', async () => {
    const foreshadowIds = Array.from(
      { length: 11 },
      (_, index) => `fs-${String(index + 1).padStart(2, '0')}`
    )
    const state = stateWithScheduledForeshadows(
      2,
      '',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 3))
    )
    const scheduledIds = foreshadowIds.slice(0, 3)
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '批次回收',
        description: '本章完成容量内的第一批线索回收。',
        fulfilledForeshadowIds: [...scheduledIds, foreshadowIds[3]!],
      },
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 2,
        fulfilledForeshadowIds: [...scheduledIds, foreshadowIds[3]!],
        expectedEvents: [...scheduledIds, foreshadowIds[3]!].map((id) =>
          createForeshadowFulfillEvent(id, 2)
        ),
      }),
    })

    const result = await expandOutlineForChapter(state, 2, createMockProvider())

    expect(result.storyArc?.acts.map((act) => [act.startChapter, act.endChapter])).toEqual([
      [1, 6],
      [7, 7],
    ])
    expect(result.totalChapters).toBe(7)
    expect(result.story?.totalChapters).toBe(7)
    expect(result.outline).toHaveLength(7)
    expect(result.outline?.[2]?.fulfilledForeshadowIds).toEqual([
      ...scheduledIds,
      foreshadowIds[3]!,
    ])
    expect(result.chapterPlan.fulfilledForeshadowIds).toEqual([...scheduledIds, foreshadowIds[3]!])
    expect(
      result.chapterPlan.expectedEvents
        .filter((event) => event.type === 'foreshadow-fulfill')
        .map((event) => event.foreshadowId)
    ).toEqual([...scheduledIds, foreshadowIds[3]!])
    const jitInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      foreshadowObligations?: Array<{ id: string }>
    }
    const obligationIds = jitInput.foreshadowObligations?.map(({ id }) => id) ?? []
    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
    expect(obligationIds).toEqual(scheduledIds)
    for (const id of [...scheduledIds, foreshadowIds[3]!]) expect(formattedOutline).toContain(id)
    for (const id of foreshadowIds.slice(4)) expect(obligationIds).not.toContain(id)
    for (const id of foreshadowIds.slice(4)) {
      expect(formattedOutline).not.toContain(id)
    }
  })

  it('requires manual adjustment when JIT auto-deferral exceeds act extension limits', async () => {
    const foreshadowIds = Array.from(
      { length: 11 },
      (_, index) => `fs-${String(index + 1).padStart(2, '0')}`
    )
    const state = stateWithScheduledForeshadows(
      2,
      '',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 3))
    )
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '遗漏版本',
        description: '未声明调度批次。',
        fulfilledForeshadowIds: [],
      },
    })

    await expect(expandOutlineForChapter(state, 2, createMockProvider())).rejects.toThrow(
      '第 3 章伏笔大纲修订未收敛：必须回收 fs-01, fs-02, fs-03；最终未裁决或错误顺延 fs-01, fs-02, fs-03；修订中回退 无'
    )

    expect(planChapterWithOverrideMock).not.toHaveBeenCalled()
    expect(writeOutlineContent).not.toHaveBeenCalled()
  })

  it('stops before outline generation when mandatory capacity exceeds extension quota', async () => {
    const foreshadowIds = ['fs-a', 'fs-b', 'fs-c', 'fs-d']
    const base = stateWithScheduledForeshadows(
      2,
      '',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 3))
    )
    const state: ReducedGraphState = {
      ...base,
      storyArc: {
        ...base.storyArc!,
        acts: [
          {
            ...base.storyArc!.acts[0]!,
            autoBoundaryAdjustment: {
              originalEndChapter: 0,
              totalExtendedChapters: 3,
            },
          },
          base.storyArc!.acts[1]!,
        ],
        autoBoundaryAdjustment: {
          originalTotalChapters: 1,
          totalExtendedChapters: 3,
        },
      },
    }

    await expect(expandOutlineForChapter(state, 2, createMockProvider())).rejects.toThrow(
      /"actIndex":1.*"proposedEndChapter":4.*"availableExtensions":0.*"affectedForeshadowIds":\["fs-a","fs-b","fs-c","fs-d"\]/
    )
    expect(chapterOutlineRunMock).not.toHaveBeenCalled()
    expect(planChapterWithOverrideMock).not.toHaveBeenCalled()
  })

  it('does not auto-defer a tight mandatory batch after planner correction fails', async () => {
    const foreshadowIds = Array.from(
      { length: 11 },
      (_, index) => `fs-${String(index + 1).padStart(2, '0')}`
    )
    const state = stateWithScheduledForeshadows(
      2,
      '',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 3))
    )
    const scheduledIds = foreshadowIds.slice(0, 3)
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '已调度大纲',
        description: '声明本章调度批次。',
        fulfilledForeshadowIds: scheduledIds,
      },
    })
    planChapterWithOverrideMock.mockResolvedValue({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 2,
        fulfilledForeshadowIds: scheduledIds,
      }),
    })

    await expect(expandOutlineForChapter(state, 2, createMockProvider())).rejects.toThrow(
      '第 3 章章节规划无法为本章必须回收的伏笔生成结构化证据：fs-01, fs-02, fs-03'
    )

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(2)
    expect(writeOutlineContent).not.toHaveBeenCalled()
  })

  it('rejects a time-anchor replan that drops a scheduled fulfillment event', async () => {
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [
      createRequiredForeshadow('fs-due', 2),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 1 ? { ...item, fulfilledForeshadowIds: ['fs-due'] } : item
      ),
    }
    const initiallyValidEvidence = createCompleteChapterPlan({
      chapterIndex: 1,
      fulfilledForeshadowIds: ['fs-due'],
      expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
      chapterTimeAnchor: '错误承接',
    })
    const droppedEvent = createCompleteChapterPlan({
      chapterIndex: 1,
      fulfilledForeshadowIds: ['fs-due'],
      chapterTimeAnchor: '修正承接',
    })
    planChapterWithOverrideMock
      .mockResolvedValueOnce({ chapterPlan: initiallyValidEvidence })
      .mockResolvedValueOnce({ chapterPlan: droppedEvent })
    vi.mocked(readChapterContent).mockResolvedValueOnce('上一章正文。')
    vi.mocked(contextJudge.batchValidateTimeAnchors).mockResolvedValueOnce([
      { valid: false, reason: '时间锚点不一致' },
    ])

    await expect(expandOutlineForChapter(state, 1, createMockProvider())).rejects.toThrow(
      '第 2 章时间锚点重规划遗漏大纲声称的伏笔兑现证据：fulfilledForeshadowIds：（无遗漏）；expectedEvents.foreshadow-fulfill：fs-due（单章容量 3）'
    )
  })

  it('rejects a budget replan that drops a scheduled declaration', async () => {
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [
      createRequiredForeshadow('fs-due', 2),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 1 ? { ...item, fulfilledForeshadowIds: ['fs-due'] } : item
      ),
    }
    const sections: ChapterPlan['sections'] = [
      {
        title: '核心事件',
        summary: '推进核心事件',
        wordCount: 1000,
        events: ['核心事件'],
        characters: ['主角'],
        timeMark: '当前',
      },
      {
        title: '偏离事件',
        summary: '偏离大纲重心',
        wordCount: 2000,
        events: ['偏离事件'],
        characters: ['主角'],
        timeMark: '稍后',
      },
    ]
    const initiallyValidEvidence = createCompleteChapterPlan({
      chapterIndex: 1,
      sections,
      outlineCheck: [{ requirement: '核心事件', fulfilled: true, section: '核心事件' }],
      fulfilledForeshadowIds: ['fs-due'],
      expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
    })
    const droppedDeclaration = createCompleteChapterPlan({
      chapterIndex: 1,
      sections,
      outlineCheck: [{ requirement: '核心事件', fulfilled: true, section: '核心事件' }],
      expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
    })
    planChapterWithOverrideMock
      .mockResolvedValueOnce({ chapterPlan: initiallyValidEvidence })
      .mockResolvedValueOnce({ chapterPlan: droppedDeclaration })
    mockChatStructured.mockResolvedValue({ results: [true, false] })

    await expect(expandOutlineForChapter(state, 1, createMockProvider())).rejects.toThrow(
      '第 2 章预算重规划遗漏大纲声称的伏笔兑现证据：fulfilledForeshadowIds：fs-due；expectedEvents.foreshadow-fulfill：（无遗漏）（单章容量 3）'
    )
  })

  it('passes the previous chapter ending into JIT outline generation', async () => {
    vi.mocked(readChapterContent).mockResolvedValue(
      '上一章最后，主角已经离开医务室，沿走廊继续朝七班教室方向走。'
    )
    const jitState: ReducedGraphState = {
      ...baseState,
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '脱困', description: '主角脱困并反击。' },
      ],
    }

    await expandOutlineForChapter(jitState, 1, createMockProvider())

    const agentInput = chapterOutlineRunMock.mock.calls[0]![0] as { previousChapters?: string }
    expect(agentInput.previousChapters).toContain('上一章结尾片段')
    expect(agentInput.previousChapters).toContain('继续朝七班教室方向走')
  })

  it('filters stale act-pressure constraints before generating a JIT outline', async () => {
    const staleActPressure = createActPressureConstraint(
      1,
      '第 1 幕「旧幕」还剩 1 章结束，必须优先消费以下 mandatory beats：旧幕节拍。'
    )
    const currentActPressure = createActPressureConstraint(
      2,
      '第 2 幕「新幕」还剩 3 章结束，必须优先消费以下 mandatory beats：新幕节拍一、新幕节拍二。'
    )
    const durableConstraint =
      createGenericVerifiedConstraint('【伏笔边界】不要提前揭示尚未到期的伏笔。')
    const jitState: ReducedGraphState = {
      ...baseState,
      totalChapters: 4,
      storyArc: {
        totalChapters: 4,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '旧幕',
            theme: '收束',
            function: '收束旧目标',
            mandatoryBeats: ['旧幕节拍'],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 4,
            title: '新幕',
            theme: '转折',
            function: '推进新目标',
            mandatoryBeats: ['新幕节拍一', '新幕节拍二'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        { number: 1, title: '旧幕收束', description: '旧幕节拍已完成。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '新幕继续', description: '新幕继续推进。' },
        { number: 4, title: '新幕收束', description: '新幕完成收束。' },
      ],
      actProgress: {
        1: { consumed: ['旧幕节拍'], pending: [] },
        2: { consumed: [], pending: ['新幕节拍一', '新幕节拍二'] },
      },
      verifiedConstraints: [staleActPressure, durableConstraint, currentActPressure],
    }
    // 配速中压（2 pending / 3 槽位 > 1/2）：认领一个节拍后一次通过
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '即时标题',
        description: '即时生成的描述。',
        introducedCharacters: [],
        claimedBeats: ['新幕节拍一'],
        claimedMandatoryBeatIds: ['A2-M1'],
      },
    })

    await expandOutlineForChapter(jitState, 1, createMockProvider())

    const agentInput = chapterOutlineRunMock.mock.calls[0]![0] as { verifiedConstraints?: string[] }
    expect(agentInput.verifiedConstraints).toEqual([
      durableConstraint.text,
      currentActPressure.text,
      '【节拍预算】本章属于第 2 幕，剩余 2 个 mandatory beats、2 章未写。本章 description 与 claimedBeats 最多承载 1 个 mandatory beat，严禁在本章内一次性推进本幕其余所有节拍。',
      // 幕边界压力自此同步注入大纲阶段（此前仅规划阶段可见）
      '【幕边界压力 - 中】第 2 幕还剩 2 章结束，仍有 2 个 mandatory beats 未消费：新幕节拍一、新幕节拍二。本章规划应优先实质消费其中 1 个；持续推迟会把消费义务压缩到幕末零余量章节，届时再无缓冲。',
    ])
  })

  it('keeps exact current-act claimed beats without description support matching', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      totalChapters: 3,
      story: { ...baseState.story, totalChapters: 3 },
      currentChapterIndex: 1,
      storyArc: {
        totalChapters: 3,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '上一幕',
            theme: '收束',
            function: '处理上一幕尾声',
            mandatoryBeats: [],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 3,
            title: '新幕',
            theme: '裂变',
            function: '外部势力干扰核心安排，主角危机浮现',
            mandatoryBeats: ['外部势力干扰核心安排'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        { number: 1, title: '旧幕收束', description: '旧幕收束。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '', description: '' },
      ],
      actProgress: {
        2: { consumed: [], pending: ['外部势力干扰核心安排'] },
      },
      chapters: [null, null, null],
    }

    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '常规赴约',
        description: '主角午后赴约，得知常规规矩，归处后等待同伴回报。',
        introducedCharacters: [],
        claimedBeats: ['外部势力干扰核心安排', '非当前幕节拍'],
        claimedMandatoryBeatIds: ['A2-M1'],
      },
    })

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    expect(result.outline?.[1]?.title).toBe('常规赴约')
    expect(result.outline?.[1]?.claimedBeats).toEqual(['外部势力干扰核心安排'])
  })

  it('caps claimed beats to the beat budget when agent over-claims', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      totalChapters: 5,
      story: { ...baseState.story, totalChapters: 5 },
      currentChapterIndex: 1,
      storyArc: {
        totalChapters: 5,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '上一幕',
            theme: '收束',
            function: '处理上一幕尾声',
            mandatoryBeats: [],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 5,
            title: '新幕',
            theme: '裂变',
            function: '外部势力干扰核心安排，主角危机浮现',
            mandatoryBeats: ['beat1', 'beat2', 'beat3'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        { number: 1, title: '旧幕收束', description: '旧幕收束。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '', description: '' },
        { number: 4, title: '', description: '' },
        { number: 5, title: '', description: '' },
      ],
      actProgress: {
        2: { consumed: [], pending: ['beat1', 'beat2', 'beat3'] },
      },
      chapters: [null, null, null, null, null],
    }

    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '过度承载',
        description: '主角同时遭遇外部压力、获得盟友、并发现真相。',
        introducedCharacters: [],
        claimedBeats: ['beat1', 'beat2', 'beat3'],
        claimedMandatoryBeatIds: ['A2-M1', 'A2-M2', 'A2-M3'],
      },
    })

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    // Chapter 2 of act 2 (3 pending, 4 remaining chapters) -> budget = ceil(0.75 * 1.5) = 2
    expect(result.outline?.[1]?.claimedBeats).toHaveLength(2)
    expect(result.outline?.[1]?.claimedBeats).toEqual(['beat1', 'beat2'])
  })

  it('keeps claimedBeatIds paired with claimedBeats when filtering and capping', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      totalChapters: 3,
      story: { ...baseState.story, totalChapters: 3 },
      currentChapterIndex: 1,
      storyArc: {
        totalChapters: 3,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '上一幕',
            theme: '收束',
            function: '处理上一幕尾声',
            mandatoryBeats: ['opening'],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 3,
            title: '新幕',
            theme: '裂变',
            function: '外部势力干扰核心安排，主角危机浮现',
            mandatoryBeats: ['beat1', 'beat2'],
          },
        ],
        keyBeats: [
          { id: 'future-id', beat: 'futureBeat', deadlineAct: 3, required: true },
          { id: 'beat1-id', beat: 'beat1', deadlineAct: 2, required: true },
          { id: 'beat2-id', beat: 'beat2', deadlineAct: 2, required: true },
        ],
      },
      outline: [
        { number: 1, title: '旧幕收束', description: '旧幕收束。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '', description: '' },
      ],
      actProgress: {
        1: { consumed: ['opening'], pending: [] },
        2: { consumed: [], pending: ['beat1', 'beat2'] },
      },
      chapters: [null, null, null],
    }

    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '配对测试',
        description: '本章推进 beat1 与 beat2，同时误报未来节拍。',
        introducedCharacters: [],
        claimedBeats: ['futureBeat', 'beat1', 'beat2'],
        claimedBeatIds: ['future-id', 'beat1-id', 'beat2-id'],
        claimedMandatoryBeatIds: ['A2-M1', 'A2-M2'],
      },
    })

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    expect(result.outline?.[1]?.claimedBeats).toEqual(['beat1', 'beat2'])
    expect(result.outline?.[1]?.claimedBeatIds).toEqual(['beat1-id', 'beat2-id'])
  })

  it('filters out already-proven mandatory beats from planner claims', async () => {
    const provenBeatId = 'A2-M1'
    const jitState: ReducedGraphState = {
      ...baseState,
      totalChapters: 3,
      story: { ...baseState.story, totalChapters: 3 },
      currentChapterIndex: 1,
      storyArc: {
        totalChapters: 3,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '上一幕',
            theme: '收束',
            function: '处理上一幕尾声',
            mandatoryBeats: ['opening'],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 3,
            title: '新幕',
            theme: '裂变',
            function: '外部势力干扰核心安排，主角危机浮现',
            mandatoryBeats: ['already proven beat'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        { number: 1, title: '旧幕收束', description: '旧幕收束。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '', description: '' },
      ],
      actProgress: {
        1: { consumed: ['opening'], pending: [] },
        2: { consumed: ['already proven beat'], pending: [] },
      },
      chapters: [null, null, null],
      storyMemory: {
        ...createEmptyStoryMemory(),
        beats: {
          [provenBeatId]: {
            id: provenBeatId,
            description: 'already proven beat',
            actIndex: 2,
            deadlineAct: 2,
            required: true,
            claimedIn: 1,
            provenByEventIds: ['evt-proven'],
          },
        },
      },
    }

    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '重复声称',
        description: '本章试图重新声称一个已在之前章节被证明的节拍。',
        introducedCharacters: [],
        claimedBeats: ['already proven beat'],
        claimedMandatoryBeatIds: [provenBeatId],
      },
    })

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    expect(result.outline?.[1]?.claimedBeats).toEqual([])
    expect(result.outline?.[1]?.claimedMandatoryBeatIds).toEqual([])
  })

  it('routes a self-reported conflict through structured foreshadow correction', async () => {
    const state = stateWithScheduledForeshadows(2, '', [
      createRequiredForeshadow('fs-self-reported-conflict', 3),
    ])
    planChapterWithOverrideMock.mockResolvedValue({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 2,
        fulfilledForeshadowIds: ['fs-self-reported-conflict'],
        expectedEvents: [createForeshadowFulfillEvent('fs-self-reported-conflict', 2)],
      }),
    })
    chapterOutlineRunMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '自报冲突',
          description: '第一版错误地顺延了本章必须兑现的伏笔。',
          fulfilledForeshadowIds: [],
          deferredForeshadowIds: ['fs-self-reported-conflict'],
          conflict: true,
          conflictReason: '模型认为当前候选无法满足伏笔规划要求。',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '结构化纠正',
          description: '第二版通过具体事件完成本章必须兑现的伏笔。',
          fulfilledForeshadowIds: ['fs-self-reported-conflict'],
          deferredForeshadowIds: [],
        },
      })

    const result = await expandOutlineForChapter(state, 2, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(2)
    const correctionInput = chapterOutlineRunMock.mock.calls[1]![0] as {
      foreshadowPlanningRejection?: {
        incorrectlyDeferredIds?: string[]
        requiredFulfillmentIds?: string[]
      }
    }
    expect(correctionInput.foreshadowPlanningRejection).toMatchObject({
      incorrectlyDeferredIds: ['fs-self-reported-conflict'],
      requiredFulfillmentIds: ['fs-self-reported-conflict'],
    })
    expect(result.outline?.[2]?.title).toBe('结构化纠正')
  })

  it('extends an overloaded current act before generating a JIT outline', async () => {
    const overloadedState: ReducedGraphState = {
      ...baseState,
      totalChapters: 6,
      story: { ...baseState.story, totalChapters: 6 },
      currentChapterIndex: 1,
      storyArc: {
        totalChapters: 6,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '第一幕',
            theme: '建立',
            function: '开篇',
            mandatoryBeats: ['开篇'],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 2,
            title: '第二幕',
            theme: '对抗',
            function: '升级冲突',
            mandatoryBeats: ['beat1', 'beat2', 'beat3', 'beat4'],
          },
          {
            index: 3,
            startChapter: 3,
            endChapter: 6,
            title: '第三幕',
            theme: '收束',
            function: '解决',
            mandatoryBeats: ['beat5'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        { number: 1, title: '启程', description: '开篇。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '', description: '' },
        { number: 4, title: '', description: '' },
        { number: 5, title: '', description: '' },
        { number: 6, title: '', description: '' },
      ],
      actProgress: {
        2: { consumed: [], pending: ['beat1', 'beat2', 'beat3', 'beat4'] },
      },
      chapters: [null, null, null, null, null, null],
    }
    // 延幕后仍是高压（4 beats / 3 章），大纲必须认领至少 1 个 mandatory beat
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '推进',
        description: '本章实质推进 beat1，并铺垫后续对抗。',
        introducedCharacters: [],
        claimedBeats: ['beat1'],
        claimedMandatoryBeatIds: ['A2-M1'],
      },
    })

    const result = await expandOutlineForChapter(overloadedState, 1, createMockProvider())

    const agentInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      storyArc: typeof overloadedState.storyArc
      totalChapters: number
      mandatoryBeatClaimRequired?: boolean
    }
    expect(agentInput.storyArc.acts.map((act) => [act.startChapter, act.endChapter])).toEqual([
      [1, 1],
      [2, 4],
      [5, 8],
    ])
    expect(agentInput.totalChapters).toBe(8)
    expect(agentInput.mandatoryBeatClaimRequired).toBe(true)
    expect(result.storyArc?.totalChapters).toBe(8)
    expect(result.outline).toHaveLength(8)
    expect(result.outline?.[1]?.claimedMandatoryBeatIds).toEqual(['A2-M1'])
  })

  it('stops before outline generation when pre-outline act extension needs manual adjustment', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const overloadedState: ReducedGraphState = {
      ...baseState,
      totalChapters: 46,
      story: { ...baseState.story, totalChapters: 46 },
      currentChapterIndex: 1,
      storyArc: {
        totalChapters: 46,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '第一幕',
            theme: '建立',
            function: '开篇',
            mandatoryBeats: [],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 2,
            title: '第二幕',
            theme: '对抗',
            function: '升级冲突',
            mandatoryBeats: ['beat1', 'beat2', 'beat3', 'beat4'],
          },
        ],
        keyBeats: [],
        autoBoundaryAdjustment: {
          originalTotalChapters: 40,
          totalExtendedChapters: 6,
        },
      },
      outline: [
        { number: 1, title: '启程', description: '开篇。' },
        { number: 2, title: '', description: '' },
      ],
      actProgress: {
        2: { consumed: [], pending: ['beat1', 'beat2', 'beat3', 'beat4'] },
      },
      chapters: [null, null],
    }

    try {
      await expect(
        expandOutlineForChapter(overloadedState, 1, createMockProvider())
      ).rejects.toThrow('museflow adjust-act story-1 --act 2 --end-chapter 4')

      expect(warnSpy).toHaveBeenCalledWith(
        '[MuseFlow] 建议运行：museflow adjust-act story-1 --act 2 --end-chapter 4'
      )
      expect(chapterOutlineRunMock).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('includes next-act boundary hint when next chapter enters new act', async () => {
    const multiActState: ReducedGraphState = {
      ...baseState,
      storyArc: {
        totalChapters: 3,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '第一幕',
            theme: '启程',
            function: '出发',
            mandatoryBeats: [],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 3,
            title: '第二幕',
            theme: '冲突',
            function: '对抗',
            mandatoryBeats: [],
          },
        ],
        keyBeats: [],
      },
    }

    await expandOutlineForChapter(multiActState, 0, createMockProvider())

    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
    expect(formattedOutline).toContain('后续幕边界提示')
  })

  it('returns boundary hints', async () => {
    const result = await expandOutlineForChapter(baseState, 1, createMockProvider())

    expect(result.boundaryHints.length).toBeGreaterThan(0)
    expect(result.chapterPlan).toBeDefined()
  })

  it('throws when plan_chapter returns no plan', async () => {
    planChapterWithOverrideMock.mockResolvedValueOnce({})
    await expect(expandOutlineForChapter(baseState, 1, createMockProvider())).rejects.toThrow(
      '详细计划生成失败'
    )
  })

  it('returns warning issue when budget validation fails after max attempts', async () => {
    const badPlan: ChapterPlan = {
      sections: [
        {
          title: '核心事件',
          summary: '买办登场',
          wordCount: 1000,
          events: ['陈裕堂登门'],
          characters: ['苏半城', '陈裕堂'],
          timeMark: '午时',
        },
        {
          title: '过渡',
          summary: '亲王回话谈判',
          wordCount: 2000,
          events: ['回话亲王'],
          characters: ['苏半城', '亲王'],
          timeMark: '巳时',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '买办登场', fulfilled: true, section: '核心事件' }],
    }
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: badPlan })
    mockChatStructured.mockResolvedValue({ results: [true, false] })

    const result = await expandOutlineForChapter(baseState, 1, createMockProvider())

    expect(result.pendingIssues).toBeDefined()
    expect(result.pendingIssues!.length).toBe(1)
    expect(result.pendingIssues![0].type).toBe('outline_density')
    expect(result.pendingIssues![0].severity).toBe('warning')
    expect(result.pendingIssues![0].description).toContain('预算修正')
  })

  it('replans when the generated chapter time anchor contradicts the previous chapter', async () => {
    const invalidPlan = createCompleteChapterPlan({
      sections: [
        {
          title: '错误锚点',
          summary: '错误地回到旧场景',
          wordCount: 3000,
          events: ['错误地回到医务室'],
          characters: ['主角'],
          timeMark: '上一章之前',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '承接上一章', fulfilled: true, section: '错误锚点' }],
      chapterTimeAnchor: '声称上一章已经回到教室',
    })
    const correctedPlan = createCompleteChapterPlan({
      sections: [
        {
          title: '正确承接',
          summary: '从上一章结尾位置继续推进',
          wordCount: 3000,
          events: ['继续朝七班教室方向走'],
          characters: ['主角'],
          timeMark: '承接上一章结尾',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '承接上一章', fulfilled: true, section: '正确承接' }],
      chapterTimeAnchor: '承接上一章结尾',
    })
    planChapterWithOverrideMock
      .mockResolvedValueOnce({ chapterPlan: invalidPlan })
      .mockResolvedValueOnce({ chapterPlan: correctedPlan })
    vi.mocked(readChapterContent).mockResolvedValue(
      '上一章最后，主角已经离开医务室，沿走廊继续朝七班教室方向走。'
    )
    vi.mocked(contextJudge.batchValidateTimeAnchors)
      .mockResolvedValueOnce([
        {
          valid: false,
          reason: 'chapterTimeAnchor 声称上一章已经回到教室，但上一章正文没有该事件',
        },
      ])
      .mockResolvedValueOnce([{ valid: true }])

    const result = await expandOutlineForChapter(baseState, 1, createMockProvider())

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(2)
    expect(result.chapterPlan).toEqual({ ...correctedPlan, chapterIndex: 1 })
    const secondPlanState = planChapterWithOverrideMock.mock.calls[1]![1] as ReducedGraphState
    expect(secondPlanState.verifiedConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('chapterTimeAnchor 声称上一章已经回到教室'),
        }),
      ])
    )
  })

  it('removes the time anchor after two failed replans and reports a structured warning issue', async () => {
    const invalidPlan: ChapterPlan = {
      sections: [
        {
          title: '错误锚点',
          summary: '错误地回到旧场景',
          wordCount: 3000,
          events: ['错误地回到医务室'],
          characters: ['主角'],
          timeMark: '上一章之前',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '承接上一章', fulfilled: true, section: '错误锚点' }],
      chapterTimeAnchor: '声称上一章已经回到教室',
    }
    planChapterWithOverrideMock
      .mockResolvedValueOnce({ chapterPlan: invalidPlan })
      .mockResolvedValueOnce({ chapterPlan: invalidPlan })
    vi.mocked(readChapterContent).mockResolvedValue(
      '上一章最后，主角已经离开医务室，沿走廊继续朝七班教室方向走。'
    )
    vi.mocked(contextJudge.batchValidateTimeAnchors)
      .mockResolvedValueOnce([
        {
          valid: false,
          reason: 'chapterTimeAnchor 声称上一章已经回到教室，但上一章正文没有该事件',
        },
      ])
      .mockResolvedValueOnce([
        {
          valid: false,
          reason: 'chapterTimeAnchor 声称上一章已经回到教室，但上一章正文没有该事件',
        },
      ])

    const result = await expandOutlineForChapter(baseState, 1, createMockProvider())

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(2)
    expect(result.chapterPlan.chapterTimeAnchor).toBeUndefined()
    const anchorIssue = result.pendingIssues?.find((i) => i.id === 'time-anchor-removed-1')
    expect(anchorIssue).toMatchObject({
      type: 'continuity',
      severity: 'warning',
      source: 'consistency',
      retryStrategy: 'fix',
    })
    expect(anchorIssue?.retryStrategy).not.toBe('manual')
  })
})

describe('validateChapterTimeAnchor', () => {
  beforeEach(() => {
    vi.mocked(contextJudge.batchValidateTimeAnchors).mockReset()
    vi.mocked(contextJudge.batchValidateTimeAnchors).mockResolvedValue([{ valid: true }])
  })

  it('passes when anchor does not claim previous events are completed', async () => {
    const plan: ChapterPlan = {
      sections: [],
      timeline: [],
      outlineCheck: [],
      chapterTimeAnchor: '三日期限第三日卯时（继续推进）',
    }

    const result = await validateChapterTimeAnchor(plan, '第六章正文：苏半城睡去。', {
      chat: vi.fn(),
    })

    expect(result.valid).toBe(true)
  })

  it('fails when anchor claims an event was completed in the previous chapter but text does not contain it', async () => {
    const plan: ChapterPlan = {
      sections: [],
      timeline: [],
      outlineCheck: [],
      chapterTimeAnchor: '三日期限第三日卯时末，昨日午时回话亲王已落地',
    }
    vi.mocked(contextJudge.batchValidateTimeAnchors).mockResolvedValueOnce([
      {
        valid: false,
        reason: 'chapterTimeAnchor 声称上一章已完成"回话亲王"，但上一章正文未提及该事件',
      },
    ])

    const result = await validateChapterTimeAnchor(
      plan,
      '第六章正文：苏半城亥时末睡去，次日清晨才起身赴王府。',
      { chat: vi.fn() }
    )

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('回话亲王')
  })

  it('passes when anchor claims completion and previous text contains the event', async () => {
    const plan: ChapterPlan = {
      sections: [],
      timeline: [],
      outlineCheck: [],
      chapterTimeAnchor: '三日期限第三日卯时末，昨日午时回话亲王已落地',
    }

    const result = await validateChapterTimeAnchor(
      plan,
      '第六章正文：苏半城昨日午时赴亲王府回话，当面答了办得成三字。',
      { chat: vi.fn() }
    )

    expect(result.valid).toBe(true)
  })
})

const defaultPlanningConfig = {
  coreEventRatioMin: 0.3,
  coreEventRatioTarget: 0.5,
  maxNonCoreSectionWordCount: 800,
  minCoreSectionWordCount: 1000,
  maxBackgroundTaskWordCount: 50,
  maxExecutedTaskRatio: 0.1,
  maxBridgeSceneRatio: 0.3,
  maxVerifiedConstraints: 20,
  maxNonErrorIssuesPerType: 3,
  closingForeshadowRecoveryRatio: 0.6,
  minSections: 3,
  maxSections: 6,
  minCoreSections: 2,
}

describe('validateChapterPlanBudget', () => {
  it('passes when core sections account for at least 50% of word count', async () => {
    const plan: ChapterPlan = {
      sections: [
        {
          title: '核心事件',
          summary: '买办登场',
          wordCount: 2500,
          events: ['陈裕堂登门'],
          characters: ['苏半城', '陈裕堂'],
          timeMark: '午时',
        },
        {
          title: '过渡',
          summary: '亲王回话收尾',
          wordCount: 800,
          events: ['回话亲王'],
          characters: ['苏半城'],
          timeMark: '巳时',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '买办登场', fulfilled: true, section: '核心事件' }],
    }

    const result = await validateChapterPlanBudget(plan, defaultPlanningConfig)

    expect(result.valid).toBe(true)
  })

  it('fails when core sections account for less than 50% of word count', async () => {
    const plan: ChapterPlan = {
      sections: [
        {
          title: '核心事件',
          summary: '买办登场',
          wordCount: 1000,
          events: ['陈裕堂登门'],
          characters: ['苏半城', '陈裕堂'],
          timeMark: '午时',
        },
        {
          title: '过渡',
          summary: '亲王回话谈判',
          wordCount: 2000,
          events: ['回话亲王'],
          characters: ['苏半城', '亲王'],
          timeMark: '巳时',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '买办登场', fulfilled: true, section: '核心事件' }],
    }

    const result = await validateChapterPlanBudget(plan, defaultPlanningConfig)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('50%')
  })

  it('fails when a non-core section exceeds 800 words', async () => {
    const plan: ChapterPlan = {
      sections: [
        {
          title: '核心事件',
          summary: '买办登场',
          wordCount: 3000,
          events: ['陈裕堂登门'],
          characters: ['苏半城', '陈裕堂'],
          timeMark: '午时',
        },
        {
          title: '过渡',
          summary: '亲王回话谈判',
          wordCount: 1200,
          events: ['回话亲王'],
          characters: ['苏半城', '亲王'],
          timeMark: '巳时',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '买办登场', fulfilled: true, section: '核心事件' }],
    }

    const result = await validateChapterPlanBudget(plan, defaultPlanningConfig)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('800')
  })

  it('passes for empty plans', async () => {
    const plan: ChapterPlan = {
      sections: [],
      timeline: [],
      outlineCheck: [],
    }

    const result = await validateChapterPlanBudget(plan, defaultPlanningConfig)

    expect(result.valid).toBe(true)
  })

  it('skips LLM when rule-based validation passes', async () => {
    const plan: ChapterPlan = {
      sections: [
        {
          title: '核心事件',
          summary: '买办登场',
          wordCount: 2500,
          events: ['陈裕堂登门'],
          characters: ['苏半城', '陈裕堂'],
          timeMark: '午时',
        },
        {
          title: '过渡',
          summary: '亲王回话收尾',
          wordCount: 800,
          events: ['回话亲王'],
          characters: ['苏半城'],
          timeMark: '巳时',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '买办登场', fulfilled: true, section: '核心事件' }],
    }

    const judge = vi.fn().mockResolvedValue([false, false])
    const result = await validateChapterPlanBudget(plan, defaultPlanningConfig, '大纲描述', judge)

    expect(result.valid).toBe(true)
    expect(judge).not.toHaveBeenCalled()
  })

  it('calls LLM only for ambiguous sections when rules fail', async () => {
    const plan: ChapterPlan = {
      sections: [
        {
          title: '核心事件',
          summary: '买办登场',
          wordCount: 1000,
          events: ['陈裕堂登门'],
          characters: ['苏半城', '陈裕堂'],
          timeMark: '午时',
        },
        {
          title: '过渡',
          summary: '亲王回话谈判',
          wordCount: 2000,
          events: ['回话亲王'],
          characters: ['苏半城', '亲王'],
          timeMark: '巳时',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '买办登场', fulfilled: true, section: '核心事件' }],
    }

    const judge = vi.fn().mockResolvedValue([false, true])
    const result = await validateChapterPlanBudget(plan, defaultPlanningConfig, '大纲描述', judge)

    expect(judge).toHaveBeenCalledTimes(1)
    expect(result.valid).toBe(true)
  })
})
