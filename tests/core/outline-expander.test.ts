import { describe, expect, it, vi } from 'vitest'
import * as contextJudge from '../../src/utils/context-judge.js'
import {
  expandOutlineForChapter,
  validateChapterTimeAnchor,
} from '../../src/core/outline-expander.js'
import { validateChapterPlanBudget } from '../../src/utils/chapter-planning.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { ChapterPlan } from '../../src/agents/chapter-planner.js'
import type { ModelProvider } from '../../src/model/provider.js'

const { planChapterWithOverrideMock } = vi.hoisted(() => ({
  planChapterWithOverrideMock: vi.fn(),
}))

const mockChat = vi.fn(async (): Promise<string> => '')
const mockChatStructured = vi.fn()

vi.mock('../../src/graph/nodes/planning.js', () => ({
  plan_chapter_with_override: planChapterWithOverrideMock,
}))

vi.mock('../../src/model/registry.ts', () => ({
  createProvider: (): ModelProvider => ({
    chat: mockChat,
    chatStructured: mockChatStructured,
  }),
}))

vi.mock('../../src/utils/context-judge.js', () => ({
  batchValidateTimeAnchors: vi.fn().mockResolvedValue([{ valid: true }]),
}))

const baseState: ReducedGraphState = {
  story: { id: 'story-1', title: 'Story', outputDir: '/tmp/story' },
  idea: 'idea',
  genre: 'default',
  totalChapters: 3,
  world: null,
  characters: [],
  outline: [
    { number: 1, title: '启程', description: '主角离开家乡。' },
    { number: 2, title: '遇敌', description: '主角遭遇敌人并暂时被困。' },
    { number: 3, title: '脱困', description: '主角脱困并反击。' },
  ],
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
  })

  it('calls plan_chapter with current and next chapter arcs', async () => {
    await expandOutlineForChapter(baseState, 1)

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![1] as string
    expect(formattedOutline).toContain('第2章：遇敌')
    expect(formattedOutline).toContain('主角遭遇敌人并暂时被困')
    expect(formattedOutline).toContain('第3章"脱困"')
  })

  it('includes generic next-chapter boundary hint', async () => {
    const conflictState: ReducedGraphState = {
      ...baseState,
      outline: [
        { number: 1, title: '真假美猴王', description: '六耳猕猴伏法，真宝玉获救。' },
        { number: 2, title: '三界求援', description: '如来佛祖现身辨别六耳猕猴。' },
        { number: 3, title: '后续', description: '团队继续西行。' },
      ],
    }

    await expandOutlineForChapter(conflictState, 1)

    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![1] as string
    expect(formattedOutline).toContain('不要把后续章节的核心事件提前解决')
  })

  it('returns boundary hints', async () => {
    const result = await expandOutlineForChapter(baseState, 1)

    expect(result.boundaryHints.length).toBeGreaterThan(0)
    expect(result.chapterPlan).toBeDefined()
  })

  it('throws when plan_chapter returns no plan', async () => {
    planChapterWithOverrideMock.mockResolvedValueOnce({})
    await expect(expandOutlineForChapter(baseState, 1)).rejects.toThrow('详细计划生成失败')
  })

  it('returns warning issue when budget validation fails after max attempts', async () => {
    const badPlan: ChapterPlan = {
      sections: [
        { title: '核心事件', summary: '买办登场', wordCount: 1000, events: ['陈裕堂登门'], characters: ['苏半城', '陈裕堂'], timeMark: '午时' },
        { title: '过渡', summary: '亲王回话谈判', wordCount: 2000, events: ['回话亲王'], characters: ['苏半城', '亲王'], timeMark: '巳时' },
      ],
      timeline: [],
      outlineCheck: [
        { requirement: '买办登场', fulfilled: true, section: '核心事件' },
      ],
    }
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: badPlan })
    mockChatStructured.mockResolvedValue({ results: [true, false] })

    const result = await expandOutlineForChapter(baseState, 1)

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

    const result = await validateChapterTimeAnchor(plan, '第六章正文：苏半城睡去。', { chat: vi.fn() })

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
      { valid: false, reason: 'chapterTimeAnchor 声称上一章已完成"回话亲王"，但上一章正文未提及该事件' },
    ])

    const result = await validateChapterTimeAnchor(plan, '第六章正文：苏半城亥时末睡去，次日清晨才起身赴王府。', { chat: vi.fn() })

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

    const result = await validateChapterTimeAnchor(plan, '第六章正文：苏半城昨日午时赴亲王府回话，当面答了办得成三字。', { chat: vi.fn() })

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
        { title: '核心事件', summary: '买办登场', wordCount: 2500, events: ['陈裕堂登门'], characters: ['苏半城', '陈裕堂'], timeMark: '午时' },
        { title: '过渡', summary: '亲王回话收尾', wordCount: 800, events: ['回话亲王'], characters: ['苏半城'], timeMark: '巳时' },
      ],
      timeline: [],
      outlineCheck: [
        { requirement: '买办登场', fulfilled: true, section: '核心事件' },
      ],
    }

    const result = await validateChapterPlanBudget(plan, defaultPlanningConfig)

    expect(result.valid).toBe(true)
  })

  it('fails when core sections account for less than 50% of word count', async () => {
    const plan: ChapterPlan = {
      sections: [
        { title: '核心事件', summary: '买办登场', wordCount: 1000, events: ['陈裕堂登门'], characters: ['苏半城', '陈裕堂'], timeMark: '午时' },
        { title: '过渡', summary: '亲王回话谈判', wordCount: 2000, events: ['回话亲王'], characters: ['苏半城', '亲王'], timeMark: '巳时' },
      ],
      timeline: [],
      outlineCheck: [
        { requirement: '买办登场', fulfilled: true, section: '核心事件' },
      ],
    }

    const result = await validateChapterPlanBudget(plan, defaultPlanningConfig)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('50%')
  })

  it('fails when a non-core section exceeds 800 words', async () => {
    const plan: ChapterPlan = {
      sections: [
        { title: '核心事件', summary: '买办登场', wordCount: 3000, events: ['陈裕堂登门'], characters: ['苏半城', '陈裕堂'], timeMark: '午时' },
        { title: '过渡', summary: '亲王回话谈判', wordCount: 1200, events: ['回话亲王'], characters: ['苏半城', '亲王'], timeMark: '巳时' },
      ],
      timeline: [],
      outlineCheck: [
        { requirement: '买办登场', fulfilled: true, section: '核心事件' },
      ],
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
