import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { RuntimeContext } from '../../src/core/context.js'
import { buildChapterAgentContext } from '../../src/graph/utils/chapter-context.js'

const { prepareStoryStateForChapterMock } = vi.hoisted(() => ({
  prepareStoryStateForChapterMock: vi.fn(),
}))

vi.mock('../../src/graph/utils/reconciler/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/graph/utils/reconciler/index.js')>()
  return {
    ...actual,
    prepareStoryStateForChapter: prepareStoryStateForChapterMock,
  }
})

function createMockContext(): RuntimeContext {
  return {
    provider: { chat: vi.fn().mockResolvedValue('') },
    checkpointer: {} as RuntimeContext['checkpointer'],
    config: { model: { provider: 'openai', model: 'gpt-4o', temperature: 0.7, maxTokens: 8192 } },
  }
}

function buildState(overrides: Partial<ReducedGraphState> = {}): ReducedGraphState {
  return {
    story: { id: 'story-1', title: 'Story', outputDir: '/tmp/story-1' },
    idea: 'idea',
    genre: 'default',
    totalChapters: 2,
    world: null,
    characters: [],
    storyArc: null,
    outline: [
      { number: 1, title: '起点', description: '主角出发。' },
      { number: 2, title: '终点', description: '主角抵达。' },
    ],
    actProgress: {},
    chapters: [null, null],
    currentChapterIndex: 0,
    foreshadowStack: [],
    timeline: undefined,
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: true,
    lastPrintedChapter: -1,
    lastTimelineSnapshot: null,
    chapterPlan: null,
    storyState: {
      characterLocations: {},
      characterStatus: {},
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    },
    chapterTimeAnchor: undefined,
    autoFixAttempts: 0,
    verifiedConstraints: [],
    chapterReport: null,
    blockingReport: null,
    session: {
      chapterIndex: 0,
      rewriteAttempts: 0,
      errorRewriteAttempts: 0,
      autoFixAttempts: 0,
      previousIssues: [],
      previousRawErrorCount: 0,
      routingDecision: undefined,
      forceStructuralRewrite: false,
      rewriteApproved: false,
      issueFingerprintHistory: [],
    },
    authorDecisions: {},
    ...overrides,
  }
}

describe('buildChapterAgentContext cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prepareStoryStateForChapterMock.mockImplementation(async (state: ReducedGraphState) => ({
      reconciledState: state.storyState,
      stateConflicts: '',
      itemLocationConflicts: [],
    }))
  })

  it('reuses prepared story state for the same chapter within one runtime context', async () => {
    const context = createMockContext()
    const state = buildState()

    await buildChapterAgentContext(state, 0, context)
    await buildChapterAgentContext(state, 0, context)

    expect(prepareStoryStateForChapterMock).toHaveBeenCalledTimes(1)
  })

  it('recomputes prepared story state when the story state fingerprint changes', async () => {
    const context = createMockContext()
    const state = buildState()
    const changedState = buildState({
      storyState: {
        ...state.storyState,
        currentScene: '新场景',
      },
    })

    await buildChapterAgentContext(state, 0, context)
    await buildChapterAgentContext(changedState, 0, context)

    expect(prepareStoryStateForChapterMock).toHaveBeenCalledTimes(2)
  })

  it('builds a chapter contract from handoff facts and act progress', async () => {
    const context = createMockContext()
    const state = buildState({
      totalChapters: 4,
      storyArc: {
        totalChapters: 4,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 2,
            title: '第一幕',
            theme: '建立',
            function: '建立目标',
            mandatoryBeats: ['主角获得任务', '主角交出关键物品'],
          },
          {
            index: 2,
            startChapter: 3,
            endChapter: 4,
            title: '第二幕',
            theme: '对抗',
            function: '升级冲突',
            mandatoryBeats: ['仇敌公开反击'],
          },
        ],
        keyBeats: [],
      },
      actProgress: {
        1: { consumed: ['主角获得任务'], pending: ['主角交出关键物品'] },
      },
      storyState: {
        ...buildState().storyState,
        canonicalFacts: [
          {
            id: 'cf1',
            subject: '铜钥匙',
            attribute: '持有者',
            value: '同伴',
            establishedIn: 0,
            confidence: 'high',
            source: 'chapter_text',
          },
        ],
        chapterHandoff: {
          chapterNumber: 1,
          endScene: '仓库外',
          endTime: '夜里',
          charactersPresent: ['主角', '同伴'],
          lastAction: '二人留在仓库外等候',
          openQuestions: ['后门是否能守住'],
          requiredNextOpening: '下一章应承接二人在仓库外等候的状态',
        },
      },
    })

    const agentContext = await buildChapterAgentContext(state, 1, context)

    expect(agentContext.chapterContract).toContain('【章节契约】')
    expect(agentContext.chapterContract).toContain('下一章应承接二人在仓库外等候的状态')
    expect(agentContext.chapterContract).toContain('本章可推进的 mandatory beats')
    expect(agentContext.chapterContract).toContain('主角交出关键物品')
    expect(agentContext.chapterContract).toContain('不得提前消费的后续 mandatory beats')
    expect(agentContext.chapterContract).toContain('仇敌公开反击')
    expect(agentContext.chapterContract).toContain('[铜钥匙] 持有者: 同伴')
  })

  it('keeps the most recent protected facts in the chapter contract', async () => {
    const context = createMockContext()
    const canonicalFacts = Array.from({ length: 25 }, (_, i) => ({
      id: `cf-${i}`,
      subject: `事实${i}`,
      attribute: 'status' as const,
      value: `值${i}`,
      establishedIn: i,
      confidence: 'high' as const,
      source: 'chapter_text' as const,
    }))
    const state = buildState({
      storyState: {
        ...buildState().storyState,
        canonicalFacts,
      },
    })

    const agentContext = await buildChapterAgentContext(state, 1, context)

    expect(agentContext.chapterContract).toContain('[事实24]')
    expect(agentContext.chapterContract).toContain('[事实5]')
    expect(agentContext.chapterContract).not.toContain('[事实4]')
  })

  it('renders outline_inference facts separately from protected authoritative facts', async () => {
    const context = createMockContext()
    const state = buildState({
      storyState: {
        ...buildState().storyState,
        canonicalFacts: [
          {
            id: 'cf-established',
            subject: '铜钥匙',
            attribute: 'status',
            value: '已折断',
            establishedIn: 0,
            confidence: 'high',
            source: 'chapter_text',
          },
          {
            id: 'cf-inferred',
            subject: '铜钥匙',
            attribute: 'origin',
            value: '铁匠铺',
            establishedIn: 1,
            confidence: 'medium',
            source: 'outline_inference',
          },
        ],
      },
    })

    const agentContext = await buildChapterAgentContext(state, 1, context)
    const contract = agentContext.chapterContract ?? ''

    expect(contract).toContain('【受保护权威事实】')
    expect(contract).toContain('【大纲推断事实（提示级，正文/已确立事实优先）】')
    expect(contract).toContain('[铜钥匙] status: 已折断')
    expect(contract).toContain('[铜钥匙] origin: 铁匠铺')

    const protectedSection = contract.slice(
      contract.indexOf('【受保护权威事实】'),
      contract.indexOf('【大纲推断事实')
    )
    expect(protectedSection).toContain('[铜钥匙] status: 已折断')
    expect(protectedSection).not.toContain('[铜钥匙] origin: 铁匠铺')
  })

  it('renders storyState entity IDs with readable names from storyMemory', async () => {
    const context = createMockContext()
    const state = buildState({
      storyState: {
        ...buildState().storyState,
        characterLocations: { 'c-linxuan': 'l-temple' },
      },
      storyMemory: {
        version: '1',
        lastChapterIndex: 0,
        entities: {
          characters: {
            'c-linxuan': {
              id: 'c-linxuan',
              name: '林玄',
              locationId: 'l-temple',
              status: {},
              introducedIn: 0,
            },
          },
          items: {},
          locations: {
            'l-temple': { id: 'l-temple', name: '破庙', introducedIn: 0 },
          },
          factions: {},
          plots: {},
        },
        events: [],
        foreshadows: {},
        beats: {},
        tasks: {},
      },
    })

    const agentContext = await buildChapterAgentContext(state, 0, context)

    expect(agentContext.storyState).toContain('林玄（c-linxuan）：破庙（l-temple）')
  })
})
