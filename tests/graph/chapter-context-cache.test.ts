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
})
