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

const testTempDir = join(tmpdir(), `museflow-outline-expander-${randomUUID().slice(0, 8)}`)

const { planChapterWithOverrideMock } = vi.hoisted(() => ({
  planChapterWithOverrideMock: vi.fn(),
}))

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

vi.mock('../../src/graph/agent-factory.js', () => ({
  getChapterOutlineAgent: () => ({
    run: vi.fn(async (state: { chapterIndex?: number }) => chapterOutlineRunMock(state)),
  }),
}))

vi.mock('../../src/utils/context-judge.js', () => ({
  batchValidateTimeAnchors: vi.fn().mockResolvedValue([{ valid: true }]),
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

describe('expandOutlineForChapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: { sections: [] } })
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
  })

  it('filters stale act-pressure constraints before generating a JIT outline', async () => {
    const staleActPressure = createActPressureConstraint(
      1,
      '第 1 幕「旧幕」还剩 1 章结束，必须优先消费以下 mandatory beats：旧幕节拍。'
    )
    const currentActPressure = createActPressureConstraint(
      2,
      '第 2 幕「新幕」还剩 2 章结束，必须优先消费以下 mandatory beats：新幕节拍。'
    )
    const durableConstraint =
      createGenericVerifiedConstraint('【伏笔边界】不要提前揭示尚未到期的伏笔。')
    const jitState: ReducedGraphState = {
      ...baseState,
      storyArc: {
        totalChapters: 3,
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
            endChapter: 3,
            title: '新幕',
            theme: '转折',
            function: '推进新目标',
            mandatoryBeats: ['新幕节拍'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        { number: 1, title: '旧幕收束', description: '旧幕节拍已完成。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '新幕继续', description: '新幕继续推进。' },
      ],
      actProgress: {
        1: { consumed: ['旧幕节拍'], pending: [] },
        2: { consumed: [], pending: ['新幕节拍'] },
      },
      verifiedConstraints: [staleActPressure, durableConstraint, currentActPressure],
    }

    await expandOutlineForChapter(jitState, 1, createMockProvider())

    const agentInput = chapterOutlineRunMock.mock.calls[0]![0] as { verifiedConstraints?: string[] }
    expect(agentInput.verifiedConstraints).toEqual([
      durableConstraint.text,
      currentActPressure.text,
      '【节拍预算】本章属于第 2 幕，剩余 1 个 mandatory beats、1 章未写。本章 description 与 claimedBeats 最多承载 1 个 mandatory beat，严禁在本章内一次性推进本幕其余所有节拍。',
    ])
  })

  it('keeps exact current-act claimed beats without description support matching', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      totalChapters: 4,
      story: { ...baseState.story, totalChapters: 4 },
      currentChapterIndex: 1,
      storyArc: {
        totalChapters: 4,
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
            endChapter: 4,
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
        { number: 4, title: '', description: '' },
      ],
      actProgress: {
        2: { consumed: [], pending: ['外部势力干扰核心安排'] },
      },
      chapters: [null, null, null, null],
    }

    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '常规赴约',
        description: '主角午后赴约，得知常规规矩，归处后等待同伴回报。',
        introducedCharacters: [],
        claimedBeats: ['外部势力干扰核心安排', '非当前幕节拍'],
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
      },
    })

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    // Chapter 2 of act 2 (3 pending, 4 remaining chapters) -> budget = ceil(0.75 * 1.5) = 2
    expect(result.outline?.[1]?.claimedBeats).toHaveLength(2)
    expect(result.outline?.[1]?.claimedBeats).toEqual(['beat1', 'beat2'])
  })

  it('throws JIT outline conflicts without parsing conflictReason text for retries', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      totalChapters: 4,
      story: { ...baseState.story, totalChapters: 4 },
      currentChapterIndex: 1,
      storyArc: {
        totalChapters: 4,
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
            endChapter: 4,
            title: '新幕',
            theme: '转折',
            function: '外部压力打破既定安排',
            mandatoryBeats: ['外部压力打破既定安排'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        { number: 1, title: '旧幕收束', description: '旧幕收束。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '', description: '' },
        { number: 4, title: '', description: '' },
      ],
      actProgress: {
        2: { consumed: [], pending: ['外部压力打破既定安排'] },
      },
      chapters: [null, null, null, null],
    }

    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '冲突',
        description: '主角继续原有安排。',
        introducedCharacters: [],
        claimedBeats: ['外部压力打破既定安排'],
        conflict: true,
        conflictReason:
          "本描述将 '外部压力打破既定安排' 列为 claimedBeat，但 description 未承载对应事件，属于强行贴标签。",
      },
    })

    await expect(expandOutlineForChapter(jitState, 1, createMockProvider())).rejects.toThrow(
      '即时大纲与权威事实冲突'
    )
    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
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

    const result = await expandOutlineForChapter(overloadedState, 1, createMockProvider())

    const agentInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      storyArc: typeof overloadedState.storyArc
      totalChapters: number
    }
    expect(agentInput.storyArc.acts.map((act) => [act.startChapter, act.endChapter])).toEqual([
      [1, 1],
      [2, 4],
      [5, 8],
    ])
    expect(agentInput.totalChapters).toBe(8)
    expect(result.storyArc?.totalChapters).toBe(8)
    expect(result.outline).toHaveLength(8)
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
})
