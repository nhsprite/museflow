import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { finalizeChapter } from '@/graph/services/finalization/chapter.js'
import { getSummaryAgent } from '@/graph/agent-factory.js'
import { createEmptyStoryState } from '@/storage/meta/stores/story-state.js'
import type { ReducedGraphState } from '@/graph/state.js'
import type { ModelProvider } from '@/model/provider.js'
import type { ChapterPlan } from '@/agents/types.js'
import type { StoryEvent } from '@/types/story-memory.js'
import type { StoryTime } from '@/types/story-state.js'
import {
  applyEvents,
  createEmptyStoryMemory,
  projectStoryStateFromMemory,
} from '@/story-memory/projector.js'
import { validatePlannedStoryEventAuthority } from '@/story-memory/event-authority.js'
import { validateChapterEvents } from '@/story-memory/validator.js'
import { harvestChapterCanonicalFacts } from '@/graph/services/finalization/fact-harvest.js'
import { extractEstablishedCharacters } from '@/utils/established-characters.js'
import { proposeActBoundaryAdjustments, applyActBoundaryAdjustment } from '@/utils/story-arc.js'

const { loadConfigMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn(() => ({
    model: { provider: 'openai' as const, model: 'gpt-4o' },
    autoAdjustActBoundaries: false,
  })),
}))

vi.mock('@/config/store.js', () => ({
  loadConfig: loadConfigMock,
}))

vi.mock('@/graph/agent-factory.js', () => ({
  getSummaryAgent: vi.fn(),
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
    applyActBoundaryAdjustment: vi.fn().mockReturnValue({ storyArc: null, applied: false }),
  }
})

function createMockProvider(): ModelProvider {
  return { chat: vi.fn().mockResolvedValue(''), chatStructured: vi.fn().mockResolvedValue({}) }
}

function mockSummaryAgent(endTime: StoryTime | string) {
  vi.mocked(getSummaryAgent).mockReturnValue({
    run: vi.fn().mockResolvedValue({
      success: true,
      data: {
        chapterSummary: '主角继续前行。',
        storyEvents: [],
        chapterHandoff: {
          chapterNumber: 2,
          endScene: '城门口',
          endTime,
          charactersPresent: [],
          lastAction: '主角抵达城门口',
          openQuestions: [],
        },
      },
    }),
  } as unknown as ReturnType<typeof getSummaryAgent>)
}

function buildFinalizeState(
  outputDir: string,
  overrides: Partial<ReducedGraphState> = {}
): ReducedGraphState {
  return {
    story: {
      id: 'test-story',
      title: 'Test',
      outputDir,
      genre: 'default',
      totalChapters: 5,
      status: 'writing',
      provider: 'openai',
      idea: 'test idea',
      createdAt: 0,
      updatedAt: 0,
    },
    idea: 'test idea',
    genre: 'default',
    totalChapters: 5,
    currentChapterIndex: 1,
    chapters: [
      null,
      {
        id: 'ch-2',
        storyId: 'test-story',
        number: 2,
        title: '进城',
        outline: '主角进城。',
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
      { number: 2, title: '进城', description: '主角进城。' },
      { number: 3, title: '落脚', description: '主角落脚。' },
      { number: 4, title: '遇敌', description: '主角遭遇敌人。' },
      { number: 5, title: '脱困', description: '主角脱困。' },
    ],
    storyArc: null,
    actProgress: {},
    characters: [],
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
    autoFixAttempts: 0,
    storyMemory: null,
    ...overrides,
  } as unknown as ReducedGraphState
}

describe('B.3 实体注册：mock 章节流', () => {
  const registerEvent: StoryEvent = {
    id: 'evt-register-1',
    type: 'entity-register',
    entityKind: 'character',
    entityId: 'c-minor-1',
    displayName: '沈七',
    chapterIndex: 1,
    source: 'chapter',
    evidence: { paragraphIndex: 1 },
  }
  const moveEvent: StoryEvent = {
    id: 'evt-move-1',
    type: 'character-location',
    characterId: 'c-minor-1',
    locationId: 'l-relay',
    chapterIndex: 1,
    source: 'chapter',
    evidence: { paragraphIndex: 2 },
  }

  function authorityState(): ReducedGraphState {
    const memory = createEmptyStoryMemory()
    // 既有地点实体（驿站已在前章事件流中出现过）
    memory.entities.locations['l-relay'] = { id: 'l-relay', name: 'l-relay', introducedIn: 0 }
    return {
      characters: [],
      storyArc: null,
      foreshadowStack: [],
      storyMemory: memory,
      storyState: createEmptyStoryState(),
      outline: [],
      currentChapterIndex: 1,
    } as unknown as ReducedGraphState
  }

  function buildPlan(expectedEvents: StoryEvent[]): ChapterPlan {
    return {
      chapterIndex: 1,
      sections: [],
      timeline: [],
      outlineCheck: [],
      expectedEvents,
      claimedBeatIds: [],
      fulfilledForeshadowIds: [],
      introducedForeshadowIds: [],
      resolvedTaskIds: [],
      createdTaskIds: [],
    }
  }

  it('未注册实体引用被权威校验拒绝', () => {
    const issues = validatePlannedStoryEventAuthority(authorityState(), [moveEvent])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      eventType: 'character-location',
      field: 'characterId',
      id: 'c-minor-1',
    })
  })

  it('先注册再引用：全链路通过且次要角色进入位置追踪与既有角色清单', () => {
    // 1. 规划层权威校验：注册后引用合法
    expect(
      validatePlannedStoryEventAuthority(authorityState(), [registerEvent, moveEvent])
    ).toEqual([])

    // 2. 结构化校验：注册事件不参与 missing/unexpected 对比，引用事件与规划精确匹配
    const memory = createEmptyStoryMemory()
    const plan = buildPlan([registerEvent, moveEvent])
    const result = validateChapterEvents(memory, 1, plan, [registerEvent, moveEvent])
    expect(result.missingEvents).toEqual([])
    expect(result.unexpectedEvents).toEqual([])

    // 3. 投影：注册实体获得可读名并可追踪位置
    const next = applyEvents(memory, [registerEvent, moveEvent])
    expect(next.entities.characters['c-minor-1']?.name).toBe('沈七')
    expect(next.entities.characters['c-minor-1']?.locationId).toBe('l-relay')

    // 4. 身份事实回采：注册事件产生 identity canonicalFact
    const facts = harvestChapterCanonicalFacts({
      chapterIndex: 1,
      acceptedEvents: [registerEvent, moveEvent],
      finalStateDeclarations: [],
    })
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      subject: 'c-minor-1',
      attribute: 'identity',
      value: '沈七',
      source: 'chapter_text',
    })

    // 5. 注册表成为 established-characters 权威来源
    const established = extractEstablishedCharacters([], null, next)
    expect(established.map((c) => c.name)).toContain('沈七')
  })
})

describe('B.4 结构化故事时间：定稿边界确定性校验', () => {
  let tmpDir: string

  beforeEach(async () => {
    loadConfigMock.mockReturnValue({
      model: { provider: 'openai' as const, model: 'gpt-4o' },
      autoAdjustActBoundaries: false,
    })
    vi.mocked(proposeActBoundaryAdjustments).mockReturnValue([])
    vi.mocked(applyActBoundaryAdjustment).mockReturnValue({ storyArc: null, applied: false })

    tmpDir = path.join(
      process.cwd(),
      'tests',
      'tmp',
      `phase5-story-time-${Date.now()}-${Math.random()}`
    )
    await fs.mkdir(path.join(tmpDir, 'chapters'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'chapters', 'chapter_2.md'),
      '# 第二章 进城\n\n主角抵达城门口，递上文书。',
      'utf-8'
    )
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  function stateWithStoryTime(storyTime: StoryTime | string): ReducedGraphState {
    return buildFinalizeState(tmpDir, {
      storyState: {
        ...createEmptyStoryState(),
        // string 入参模拟旧 checkpoint 的自由文本 storyTime（读取路径负责归一化）。
        storyTime: storyTime as StoryTime,
      },
    })
  }

  it('第 N 章 storyTime 早于第 N-1 章被 structured.time-regression 拦截', async () => {
    mockSummaryAgent({ era: '贞观', year: 3 })
    const result = await finalizeChapter(
      stateWithStoryTime({ era: '贞观', year: 18 }),
      createMockProvider()
    )

    expect(result.rewriteRequested).toBe(true)
    const issue = result.pendingIssues?.find((i) => i.ruleId === 'structured.time-regression')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('error')
  })

  it('年号不一致被 structured.time-era-conflict 拦截', async () => {
    mockSummaryAgent({ era: '元狩', year: 1 })
    const result = await finalizeChapter(
      stateWithStoryTime({ era: '贞观', year: 18 }),
      createMockProvider()
    )

    expect(result.rewriteRequested).toBe(true)
    const issue = result.pendingIssues?.find((i) => i.ruleId === 'structured.time-era-conflict')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('error')
  })

  it('时间单调前进时不产生时间类问题，storyTime 更新为结构化值', async () => {
    mockSummaryAgent({ era: '贞观', year: 18, month: 3, day: 2, dayFraction: 'evening' })
    const result = await finalizeChapter(
      stateWithStoryTime({ era: '贞观', year: 18, month: 3, day: 1 }),
      createMockProvider()
    )

    expect(result.rewriteRequested).toBeFalsy()
    expect(
      result.pendingIssues?.filter(
        (i) =>
          i.ruleId === 'structured.time-regression' || i.ruleId === 'structured.time-era-conflict'
      )
    ).toEqual([])
    expect(result.storyState?.storyTime).toEqual({
      era: '贞观',
      year: 18,
      month: 3,
      day: 2,
      dayFraction: 'evening',
    })
  })

  it('旧格式 freeform storyTime 不参与单调性判定（不可比较不报错），行为不回归', async () => {
    mockSummaryAgent({ era: '贞观', year: 3 })
    const result = await finalizeChapter(stateWithStoryTime('贞观十八年春'), createMockProvider())

    expect(result.rewriteRequested).toBeFalsy()
    expect(
      result.pendingIssues?.filter(
        (i) =>
          i.ruleId === 'structured.time-regression' || i.ruleId === 'structured.time-era-conflict'
      )
    ).toEqual([])
    expect(result.storyState?.storyTime).toEqual({ era: '贞观', year: 3 })
  })
})
