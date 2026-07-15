import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runStory } from '../../src/core/runner.js'
import { runOneChapter } from '../../src/core/runner.js'
import { prepareChapter } from '../../src/graph/services/chapter-orchestration/preparation.js'
import { createStory } from '../../src/storage/meta/stores/story.js'
import { JsonCheckpointer } from '../../src/graph/checkpointer.js'
import { applyEvents, createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import { getCanonicalForeshadows } from '../../src/story-memory/foreshadow-alias.js'
import { getBoundaryBlockingForeshadows } from '../../src/story-memory/foreshadow-policy.js'
import type { ModelProvider, Message, JsonSchema } from '../../src/model/provider.js'
import type { RuntimeContext } from '../../src/core/context.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { ChapterPlan } from '../../src/agents/types.js'
import type { Issue } from '../../src/types/agent.js'
import type { AgentOutput } from '../../src/agents/base.js'
import type { StoryEvent } from '../../src/types/story-memory.js'

const mockChat = vi.fn(async (_messages: Message[], _temperature?: number): Promise<string> => '')
const mockChatStructured = vi.fn(
  async <T>(_messages: Message[], _schema: JsonSchema, _temperature?: number): Promise<T> => {
    if (Object.hasOwn(_schema.properties, 'judgments')) {
      return {
        judgments: [
          {
            foreshadowId: 'fs-locket',
            verdict: 'fulfilled',
            reason: '测试正文明确完成了该结构化线索的回收。',
          },
        ],
      } as T
    }
    return {} as T
  }
)

function createMockProvider(): ModelProvider {
  return { chat: mockChat, chatStructured: mockChatStructured }
}

function createEquivalenceProvider(): ModelProvider {
  return {
    chat: vi.fn().mockRejectedValue(new Error('equivalence audit must use structured output')),
    chatStructured: vi
      .fn()
      .mockResolvedValueOnce({
        groups: [
          {
            ids: ['fs-a-later', 'fs-z-earliest'],
            reason: 'Both records represent one unresolved obligation.',
          },
        ],
      })
      .mockResolvedValue({ groups: [] }),
  }
}

function stateWithEquivalentAndIndependentActiveIds(): ReducedGraphState {
  const storyMemory = applyEvents(createEmptyStoryMemory(), [
    {
      id: 'introduce-earliest',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-z-earliest',
      text: 'An unresolved obligation is recorded.',
      kind: 'other',
      expectedFulfillChapter: 4,
      resolutionPolicy: 'must_resolve',
      required: true,
      chapterIndex: 0,
      source: 'outline',
    },
    {
      id: 'introduce-later',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-a-later',
      text: 'The same unresolved obligation is recorded again.',
      kind: 'other',
      expectedFulfillChapter: 4,
      resolutionPolicy: 'must_resolve',
      required: true,
      chapterIndex: 1,
      source: 'outline',
    },
    {
      id: 'introduce-independent',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-m-independent',
      text: 'A separate open possibility is recorded.',
      kind: 'other',
      expectedFulfillChapter: null,
      resolutionPolicy: 'may_remain_open',
      required: false,
      chapterIndex: 1,
      source: 'outline',
    },
  ])

  return {
    currentChapterIndex: 2,
    totalChapters: 4,
    pendingIssues: [],
    foreshadowStack: [],
    verifiedConstraints: [],
    storyMemory,
  } as unknown as ReducedGraphState
}

function createMockContext(): RuntimeContext {
  return {
    provider: createMockProvider(),
    checkpointer: new JsonCheckpointer(),
    config: { model: { provider: 'openai', model: 'gpt-4o', temperature: 0.7, maxTokens: 8192 } },
  }
}

function makeChapterContent(chapterIndex: number): string {
  const sentence = '主角走在青石板路上，心中思索着接下来的计划，脚步不由得加快了几分。'
  const body = Array.from({ length: 120 }, () => sentence).join('')
  return `# 第${chapterIndex + 1}章 测试章节\n\n${body}\n\n第${chapterIndex + 1}章结尾。`
}

const chapter1Events: StoryEvent[] = [
  {
    id: 'evt-fs1-intro',
    type: 'foreshadow-introduce',
    foreshadowId: 'fs-locket',
    expectedFulfillChapter: 2,
    resolutionPolicy: 'must_resolve',
    required: true,
    text: '待回收的结构化线索',
    kind: 'other',
    beatId: null,
    chapterIndex: 0,
    source: 'chapter',
    evidence: { paragraphIndex: 1 },
  },
  {
    id: 'evt-beat-1',
    type: 'plot-advance',
    plotId: 'plot-main',
    beatId: 'beat-1',
    chapterIndex: 0,
    source: 'chapter',
    evidence: { paragraphIndex: 1 },
  },
]

const chapter2Events: StoryEvent[] = [
  {
    id: 'evt-fs1-fulfill',
    type: 'foreshadow-fulfill',
    foreshadowId: 'fs-locket',
    chapterIndex: 1,
    source: 'chapter',
    evidence: { paragraphIndex: 1 },
  },
  {
    id: 'evt-beat-2',
    type: 'plot-advance',
    plotId: 'plot-main',
    beatId: 'beat-2',
    chapterIndex: 1,
    source: 'chapter',
    evidence: { paragraphIndex: 1 },
  },
]

vi.mock('../../src/graph/agent-factory.js', () => ({
  getWorldbuilderAgent: () => ({
    run: vi.fn(async () => ({
      success: true,
      data: { title: '测试故事', world: '这是一个测试世界观。' },
    })),
    processOutput: vi.fn((output: { data: { world: string } }, storyId: string) => ({
      id: 'world-test',
      storyId,
      content: output.data.world,
    })),
    extractTitle: vi.fn((output: { data: { title: string } }) => output.data.title),
  }),
  getCharacterAgent: () => ({
    run: vi.fn(async () => ({
      success: true,
      data: [{ 姓名: '主角', 背景故事: '测试背景', 对话风格: '沉稳' }],
    })),
    processOutput: vi.fn((output: { data: Array<Record<string, string>> }, storyId: string) =>
      output.data.map((c, idx) => ({
        id: `char-test-${idx}`,
        storyId,
        name: String(c['姓名'] || c['name'] || '未命名'),
        description: (c['背景故事'] || c['description'] || null) as string | null,
        dialogueStyle: (c['对话风格'] || c['dialogueStyle'] || null) as string | null,
        createdAt: Date.now(),
      }))
    ),
  }),
  getStoryArcAgent: () => ({
    run: vi.fn(async (state: { totalChapters: number }) => ({
      success: true,
      data: {
        totalChapters: state.totalChapters,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: state.totalChapters,
            title: '第一幕',
            theme: '测试主题',
            function: '测试功能',
            mandatoryBeats: [],
          },
        ],
        keyBeats: [],
      },
    })),
  }),
  getChapterAgent: () => ({
    run: vi.fn(async (state: { chapterIndex?: number }) => {
      const idx = state.chapterIndex ?? 0
      return {
        success: true,
        content: makeChapterContent(idx),
        data: {
          preWriteCheck: 'checked',
          storyEvents: idx === 0 ? chapter1Events : idx === 1 ? chapter2Events : [],
        },
      }
    }),
  }),
  getChapterPlannerAgent: vi.fn(),
  getForeshadowingAgent: () => ({
    run: vi.fn(async () => ({ success: true, content: '', data: { planted: [], fulfilled: [] } })),
    processOutput: vi.fn(
      async (_output: unknown, _chapterIndex: number, existingStack: unknown) => existingStack
    ),
  }),
  getConsistencyAgent: () => ({
    run: vi.fn(async () => ({ success: true, content: '', data: { issues: [] } })),
    processOutput: vi.fn(async () => [] as Issue[]),
  }),
  getFixAgent: () => ({
    run: vi.fn(async () => ({ success: true, content: '', data: {} })),
    processOutput: vi.fn(() => ({ content: makeChapterContent(0), chapterMeta: null })),
  }),
  getSummaryAgent: () => ({
    run: vi.fn(async (state: { chapterIndex?: number }) => {
      const idx = state.chapterIndex ?? 0
      return {
        success: true,
        content: `第${idx + 1}章摘要`,
        data: { chapterSummary: `第${idx + 1}章摘要`, storyEvents: [] },
      }
    }),
    processOutput: vi.fn((output: AgentOutput) => {
      const data = output.data as { chapterSummary?: string } | undefined
      return { summary: data?.chapterSummary ?? '', storyState: undefined }
    }),
  }),
}))

vi.mock('../../src/core/outline-expander.js', () => ({
  expandOutlineForChapter: vi.fn(
    async (_state: ReducedGraphState, chapterIndex: number, _context: RuntimeContext) => ({
      chapterPlan: {
        chapterIndex,
        sections: [
          {
            title: '核心场景',
            summary: '测试场景',
            wordCount: 2500,
            events: ['测试事件'],
            characters: ['主角'],
          },
        ],
        timeline: [],
        outlineCheck: [],
        expectedEvents:
          chapterIndex === 0 ? chapter1Events : chapterIndex === 1 ? chapter2Events : [],
        claimedBeatIds: [],
        fulfilledForeshadowIds: chapterIndex === 1 ? ['fs-locket'] : [],
        introducedForeshadowIds: chapterIndex === 0 ? ['fs-locket'] : [],
        resolvedTaskIds: [],
        createdTaskIds: [],
      } as ChapterPlan,
      boundaryHints: [],
      pendingIssues: [],
    })
  ),
}))

describe('StoryMemory end-to-end', () => {
  let storyId: string
  let outputDir: string

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (outputDir && existsSync(outputDir)) {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('repairs equivalent active IDs once and exposes one canonical story-end obligation', async () => {
    const state = stateWithEquivalentAndIndependentActiveIds()
    const inputSnapshot = structuredClone(state)
    const provider = createEquivalenceProvider()

    const prepared = await prepareChapter(state, provider)
    const preparedState = { ...state, ...prepared }
    const preparedSnapshot = structuredClone(preparedState)
    const memory = preparedState.storyMemory!

    expect(state).toEqual(inputSnapshot)
    expect(getCanonicalForeshadows(memory).map((foreshadow) => foreshadow.id)).toEqual([
      'fs-z-earliest',
      'fs-m-independent',
    ])
    expect(memory.foreshadows['fs-a-later']?.mergedInto).toBe('fs-z-earliest')
    expect(memory.foreshadows['fs-z-earliest']).toMatchObject({
      text: 'An unresolved obligation is recorded.',
      resolutionPolicy: 'must_resolve',
      expectedFulfillChapter: 4,
    })
    expect(getBoundaryBlockingForeshadows(memory, preparedState.totalChapters, true)).toEqual([
      'fs-z-earliest',
    ])
    expect(preparedState.foreshadowStack.map((foreshadow) => foreshadow.id)).toEqual([
      'fs-z-earliest',
      'fs-m-independent',
    ])
    expect(
      preparedState.verifiedConstraints
        .filter(
          (constraint) =>
            constraint.kind === 'generic' && constraint.id?.startsWith('memory:foreshadow:')
        )
        .map((constraint) => constraint.id)
    ).toEqual(['memory:foreshadow:fs-z-earliest', 'memory:foreshadow:fs-m-independent'])
    expect(
      preparedState.verifiedConstraints.some(
        (constraint) => constraint.kind === 'generic' && constraint.id?.endsWith('fs-a-later')
      )
    ).toBe(false)
    expect(prepared.foreshadowEquivalenceAudit?.activeCanonicalIds).toEqual([
      'fs-z-earliest',
      'fs-m-independent',
    ])
    expect(prepared.session?.chapterIndex).toBe(state.currentChapterIndex)
    expect(memory.events.filter((event) => event.type === 'foreshadow-merge')).toHaveLength(1)

    const rerun = await prepareChapter(preparedState, provider)
    const rerunState = { ...preparedState, ...rerun }

    expect(preparedState).toEqual(preparedSnapshot)
    expect(rerun.storyMemory).toBe(preparedState.storyMemory)
    expect(rerun.session).toBeUndefined()
    expect(rerunState.session).toBe(preparedState.session)
    expect(rerun.foreshadowEquivalenceAudit?.activeCanonicalIds).toEqual([
      'fs-z-earliest',
      'fs-m-independent',
    ])
    expect(rerunState.foreshadowEquivalenceAudit?.activeCanonicalIds).toEqual([
      'fs-z-earliest',
      'fs-m-independent',
    ])
    expect(provider.chatStructured).toHaveBeenCalledTimes(1)
    expect(provider.chat).not.toHaveBeenCalled()
    expect(
      rerunState.storyMemory?.events.filter((event) => event.type === 'foreshadow-merge')
    ).toHaveLength(1)
    expect(
      getBoundaryBlockingForeshadows(rerunState.storyMemory!, rerunState.totalChapters, true)
    ).toEqual(['fs-z-earliest'])
  })

  it(
    'initializes storyMemory during story creation, tracks events, foreshadows and beats across chapters',
    { timeout: 60000 },
    async () => {
      const totalChapters = 5
      const story = createStory({
        idea: '一条用于验证 StoryMemory 的测试故事',
        genre: 'default',
        totalChapters,
        provider: 'openai',
        title: 'StoryMemory E2E',
      })
      storyId = story.id
      outputDir = story.outputDir

      const context = createMockContext()

      const startResult = await runStory(
        {
          storyId: story.id,
          idea: story.idea,
          genre: story.genre,
          totalChapters,
          story,
        },
        context
      )

      expect(startResult.storyMemory).not.toBeNull()
      expect(startResult.storyMemory?.version).toBe('3')
      expect(startResult.storyMemory?.events).toHaveLength(0)

      const chapter1Result = await runOneChapter(
        storyId,
        { mode: 'draft', targetChapterIndex: 0 },
        context
      )

      expect(chapter1Result.currentChapterIndex).toBe(1)
      expect(chapter1Result.storyMemory).not.toBeNull()
      expect(chapter1Result.storyMemory!.events.length).toBeGreaterThan(0)
      expect(
        chapter1Result.storyMemory!.events.some(
          (e) => e.type === 'foreshadow-introduce' && e.foreshadowId === 'fs-locket'
        )
      ).toBe(true)
      expect(chapter1Result.storyMemory!.foreshadows['fs-locket']).toBeDefined()
      expect(chapter1Result.storyMemory!.foreshadows['fs-locket'].introducedIn).toBe(0)
      expect(chapter1Result.storyMemory!.foreshadows['fs-locket'].fulfilledIn).toBeNull()
      expect(chapter1Result.storyMemory!.foreshadows['fs-locket'].resolutionPolicy).toBe(
        'must_resolve'
      )
      expect(chapter1Result.storyMemory!.beats['beat-1']).toBeDefined()
      expect(chapter1Result.storyMemory!.beats['beat-1'].provenByEventIds).toContain('evt-beat-1')

      const chapter2Result = await runOneChapter(
        storyId,
        { mode: 'draft', targetChapterIndex: 1 },
        context
      )

      expect(chapter2Result.currentChapterIndex).toBe(2)
      expect(
        chapter2Result.storyMemory!.events.some(
          (e) => e.type === 'foreshadow-fulfill' && e.foreshadowId === 'fs-locket'
        )
      ).toBe(true)
      expect(chapter2Result.storyMemory!.foreshadows['fs-locket'].fulfilledIn).toBe(1)
      expect(chapter2Result.storyMemory!.beats['beat-2']).toBeDefined()
      expect(chapter2Result.storyMemory!.beats['beat-2'].provenByEventIds).toContain('evt-beat-2')

      const chapterFile = join(outputDir, 'chapters', 'chapter_1.md')
      expect(existsSync(chapterFile)).toBe(true)
    }
  )
})
