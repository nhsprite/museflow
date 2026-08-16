import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runOneChapter } from '../../src/core/runner.js'
import { createEmptyStoryState } from '../../src/storage/meta/stores/story-state.js'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { ChapterPlan } from '../../src/agents/chapter-planner.js'
import type { Issue } from '../../src/types/agent.js'
import type { Message, ModelProvider } from '../../src/model/provider.js'
import type { RuntimeContext } from '../../src/core/context.js'
import type { StoryEvent } from '../../src/types/story-memory.js'
import type { ChapterSession } from '../../src/core/chapter-generation/routing/types.js'
import { JsonCheckpointer } from '../../src/graph/checkpointer.js'

/**
 * mandatory beat 消费佐证集成测试（D.2.1/D.2.2）：mock 章节流。
 * 场景 1：认领的 mandatory beat 单段 proven、无任何佐证 → 不消费，携带
 *         beatCorroboration 反馈重试一次，耗尽后按未证明走撤销路径；
 * 场景 2：推进事件有共享锚点的状态类事件佐证 → 正常消费；
 * 场景 3：幕末章未佐证的 mandatory beat 被幕关闭质量复审拦下。
 */

let tmpDir: string
let storyId: string

/** 当前场景下 chapter agent 应输出的事件流（各用例覆盖）。 */
let scenarioEvents: StoryEvent[] = []

/** 当前场景下章节规划授权的事件（非 plot-advance 的未授权事件是硬错误）。 */
let scenarioExpectedEvents: StoryEvent[] = []

// 语义验证 mock：对 plot-advance 验证请求一律判 proven（本测试聚焦佐证层，
// 不改变上游 LLM 判定逻辑）；其他结构化请求返回空对象。
const mockChat = vi.fn(async (): Promise<string> => '')
const mockChatStructured = vi.fn(async (messages: Message[]) => {
  const content = messages[1]?.content
  if (typeof content === 'string' && content.includes('请判断以下结构化候选')) {
    const candidates = JSON.parse(content.slice(content.indexOf('\n') + 1)) as Array<{
      eventId: string
      beatId: string
    }>
    return {
      judgments: candidates.map((candidate) => ({
        eventId: candidate.eventId,
        beatId: candidate.beatId,
        verdict: 'proven',
        reason: '证据段落呈现了节拍所述事件',
      })),
    }
  }
  return {}
})

function createMockProvider(): ModelProvider {
  return { chat: mockChat, chatStructured: mockChatStructured }
}

function createMockContext(): RuntimeContext {
  return {
    provider: createMockProvider(),
    checkpointer: new JsonCheckpointer(),
    config: { model: { provider: 'openai', model: 'gpt-4o', temperature: 0.7, maxTokens: 8192 } },
  }
}

// 大纲展开 mock：plan 的认领集合跟随 state.outline（撤销认领后不再重放），
// 以模拟真实 outline-expander 按持久化大纲重建 plan 的行为。
const expandOutlineForChapterMock = vi.hoisted(() =>
  vi.fn(async (state: unknown, chapterIndex: number) => {
    const outline = (state as ReducedGraphState).outline
    const item = outline[chapterIndex]
    return {
      chapterPlan: {
        chapterIndex,
        sections: [
          {
            title: '核心',
            summary: '核心事件',
            wordCount: 6000,
            events: ['核心事件'],
            characters: ['主角'],
          },
        ],
        timeline: [],
        outlineCheck: [],
        expectedEvents: [...scenarioExpectedEvents],
        claimedMandatoryBeatIds: [...(item?.claimedMandatoryBeatIds ?? [])],
        claimedBeatIds: [],
        fulfilledForeshadowIds: [],
        introducedForeshadowIds: [],
        resolvedTaskIds: [],
        createdTaskIds: [],
      } as ChapterPlan,
      boundaryHints: [],
      pendingIssues: [],
    }
  })
)

vi.mock('../../src/core/outline-expander.js', () => ({
  expandOutlineForChapter: expandOutlineForChapterMock,
}))

vi.mock('../../src/graph/utils/reconciler/index.js', () => ({
  prepareStoryStateForChapter: vi.fn(async (state: ReducedGraphState) => ({
    reconciledState: state.storyState ?? createEmptyStoryState(),
    stateConflicts: '',
    itemLocationConflicts: [],
  })),
  formatStoryState: vi.fn(() => ''),
  formatCanonicalFactsSections: vi.fn(() => [] as string[]),
  prioritizeCanonicalFacts: vi.fn((facts: unknown[]) => facts),
  buildCharacterFactTimeline: vi.fn(() => ''),
  mergeStoryState: vi.fn((existing: unknown, update: unknown) => ({
    ...(existing as object),
    ...(update as object),
  })),
}))

let draftCounter = 0
function nextChapterContent(): string {
  draftCounter += 1
  // 三个散文段落（证据锚点 @p1-@p3 均可生效），字数达标且每次起草文本不同。
  const paragraph = (n: number) =>
    `第${draftCounter}稿第${n}幕，主角踏出关键一步，局势随之改变。`.repeat(120)
  return `# 第1章 测试章节\n\n${paragraph(1)}\n\n${paragraph(2)}\n\n${paragraph(3)}`
}

const mockChapterAgent = {
  run: vi.fn(async () => ({
    success: true,
    content: nextChapterContent(),
    data: {
      preWriteCheck: 'checked',
      storyEvents: scenarioEvents,
      finalStateDeclarations: [],
    },
  })),
}

const mockForeshadowingAgent = {
  run: vi.fn(async () => ({ success: true, content: '', data: { planted: [], fulfilled: [] } })),
  processOutput: vi.fn(
    async (_output: unknown, _chapterIndex: number, existingStack: unknown) => existingStack
  ),
}

const mockConsistencyAgent = {
  run: vi.fn(async () => ({ success: true, content: '', data: { issues: [] } })),
  processOutput: vi.fn(async () => [] as Issue[]),
}

const mockSummaryAgent = {
  run: vi.fn(async () => ({
    success: true,
    content: '本章摘要',
    data: { chapterSummary: '本章摘要', storyEvents: [] },
  })),
  processOutput: vi.fn(() => ({ summary: '本章摘要', storyState: undefined })),
}

const mockFixAgent = {
  run: vi.fn(async () => ({ success: true, content: '', data: {} })),
  processOutput: vi.fn(() => ({ content: nextChapterContent(), chapterMeta: null })),
}

vi.mock('../../src/graph/agent-factory.js', () => ({
  getWorldbuilderAgent: vi.fn(),
  getCharacterAgent: vi.fn(),
  getHighLevelOutlineAgent: vi.fn(),
  getChapterAgent: () => mockChapterAgent,
  getChapterPlannerAgent: vi.fn(),
  getForeshadowingAgent: () => mockForeshadowingAgent,
  getConsistencyAgent: () => mockConsistencyAgent,
  getFixAgent: () => mockFixAgent,
  getSummaryAgent: () => mockSummaryAgent,
}))

function plotAdvanceEvent(id: string, beatId: string, paragraphIndex: number): StoryEvent {
  return {
    id,
    type: 'plot-advance',
    plotId: 'act-1',
    beatId,
    chapterIndex: 0,
    source: 'chapter',
    evidence: { paragraphIndex },
  }
}

function statusEvent(id: string, paragraphIndex: number): StoryEvent {
  return {
    id,
    type: 'character-status',
    characterId: 'char-1',
    attribute: 'realm',
    value: '突破',
    chapterIndex: 0,
    source: 'chapter',
    evidence: { paragraphIndex },
  }
}

interface StoryArcSpec {
  totalChapters: number
  acts: Array<{
    index: number
    startChapter: number
    endChapter: number
    mandatoryBeats: string[]
  }>
}

function createInitialState(
  storyIdValue: string,
  outputDir: string,
  arc: StoryArcSpec,
  claimInFirstOutline: boolean
): ReducedGraphState {
  return {
    story: {
      id: storyIdValue,
      title: '测试故事',
      outputDir,
      genre: 'default',
      totalChapters: arc.totalChapters,
      status: 'outlining',
      provider: 'openai',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    idea: '一个测试故事',
    genre: 'default',
    totalChapters: arc.totalChapters,
    world: { id: 'world-1', storyId: storyIdValue, content: '测试世界观' },
    characters: [
      {
        id: 'char-1',
        storyId: storyIdValue,
        name: '主角',
        description: null,
        dialogueStyle: null,
        createdAt: Date.now(),
      },
    ],
    outline: Array.from({ length: arc.totalChapters }, (_, i) => ({
      id: `outline-${i}`,
      number: i + 1,
      title: `第${i + 1}章`,
      description: `第${i + 1}章的核心事件。`,
      introducedCharacters: i === 0 ? ['主角'] : [],
      ...(i === 0 && claimInFirstOutline ? { claimedMandatoryBeatIds: ['A1-M1'] } : {}),
    })),
    chapters: Array(arc.totalChapters).fill(null),
    currentChapterIndex: 0,
    foreshadowStack: [],
    timeline: [],
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: false,
    writeOneChapterOnly: true,
    lastPrintedChapter: -1,
    lastTimelineSnapshot: null,
    chapterPlan: null,
    storyState: createEmptyStoryState(),
    storyMemory: createEmptyStoryMemory(),
    chapterTimeAnchor: undefined,
    verifiedConstraints: [],
    chapterReport: null,
    authorDecisions: {},
    consecutiveZeroIncrementChapters: 0,
    consecutiveZeroClaimChapters: 0,
    storyArc: {
      totalChapters: arc.totalChapters,
      acts: arc.acts.map((act) => ({
        index: act.index,
        startChapter: act.startChapter,
        endChapter: act.endChapter,
        title: `第${act.index}幕`,
        theme: '主题',
        function: '功能',
        mandatoryBeats: act.mandatoryBeats,
      })),
      keyBeats: [],
    },
    actProgress: Object.fromEntries(
      arc.acts.map((act) => [act.index, { consumed: [], pending: [...act.mandatoryBeats] }])
    ),
    session: {
      chapterIndex: 0,
      rewriteAttempts: 0,
      errorRewriteAttempts: 0,
      autoFixAttempts: 0,
      previousIssues: [],
      previousRawErrorCount: 0,
      forceStructuralRewrite: false,
      routingDecision: undefined,
      rewriteApproved: false,
    } as ChapterSession,
  } as unknown as ReducedGraphState
}

function writeInitialCheckpoint(outputDir: string, state: ReducedGraphState): void {
  const checkpointDir = join(outputDir, 'checkpoints')
  mkdirSync(checkpointDir, { recursive: true })

  const checkpointId = 'test-initial-checkpoint'
  const checkpoint = {
    checkpointId,
    parentCheckpointId: null,
    checkpoint: {
      v: 4,
      id: checkpointId,
      ts: new Date().toISOString(),
      channel_values: state,
      channel_versions: {},
      versions_seen: {},
    },
    metadata: {
      source: 'update',
      step: 1,
      parents: {},
      thread_id: state.story.id,
    },
  }

  writeFileSync(join(checkpointDir, `${checkpointId}.json`), JSON.stringify(checkpoint), 'utf-8')
  writeFileSync(
    join(checkpointDir, 'latest.json'),
    JSON.stringify({ checkpointId, ts: checkpoint.checkpoint.ts }),
    'utf-8'
  )
}

function setupStory(state: ReducedGraphState): void {
  writeFileSync(join(tmpDir, 'meta.json'), JSON.stringify({ story: state.story }), 'utf-8')
  writeInitialCheckpoint(tmpDir, state)
}

describe('beat corroboration integration (D.2)', () => {
  beforeEach(() => {
    storyId = `story_test_beat_corrob_${randomUUID().slice(0, 8)}`
    const shortId = storyId.split('_').pop()?.slice(0, 12).toLowerCase() ?? storyId
    tmpDir = join(process.cwd(), 'books', `beat-corrob-${shortId}-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    vi.clearAllMocks()
    scenarioEvents = []
    scenarioExpectedEvents = []
    draftCounter = 0
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it(
    'retries a claimed single-paragraph-proven mandatory beat with beatCorroboration feedback, then revokes the claim on exhaustion',
    { timeout: 60000 },
    async () => {
      const arc: StoryArcSpec = {
        totalChapters: 3,
        acts: [{ index: 1, startChapter: 1, endChapter: 3, mandatoryBeats: ['主角觉醒'] }],
      }
      const state = createInitialState(storyId, tmpDir, arc, true)
      setupStory(state)
      // 单段 proven：只有裸推进事件，没有任何状态类事件或终态声明佐证
      scenarioEvents = [plotAdvanceEvent('evt-p1', 'A1-M1', 2)]

      const result = await runOneChapter(
        storyId,
        { mode: 'draft', targetChapterIndex: 0 },
        createMockContext()
      )

      // 重试反馈：某一轮起草的输入 issues 中携带 beat_uncorroborated 反馈
      const feedbackCall = mockChapterAgent.run.mock.calls.find((call) => {
        const input = call[0] as { issues?: Issue[] }
        return input.issues?.some((issue) => issue.type === 'beat_uncorroborated')
      })
      expect(feedbackCall).toBeDefined()
      const feedbackIssue = (feedbackCall?.[0] as { issues: Issue[] }).issues.find(
        (issue) => issue.type === 'beat_uncorroborated'
      )
      expect(feedbackIssue?.suggestion).toContain('结构化痕迹')

      // 重试耗尽 → 按未证明处理：认领从持久化大纲中撤销（后续章节可重新认领）
      expect(result.outline[0]?.claimedMandatoryBeatIds ?? []).not.toContain('A1-M1')

      // 撤销后正文仍声明同一推进事件：作为未认领但经验证的真实进展接受，章节定稿；
      // 但 beat 未佐证，审计记录为 proven_uncorroborated，幕进度不消费它。
      expect(result.currentChapterIndex).toBe(1)
      expect(existsSync(join(tmpDir, 'chapters', 'chapter_1.md'))).toBe(true)
      expect(result.storyMemory?.beats['A1-M1']?.provenByEventIds.length).toBeGreaterThan(0)
      expect(result.storyMemory?.beats['A1-M1']?.corroboration?.status).toBe(
        'proven_uncorroborated'
      )
      expect(result.actProgress?.[1]?.pending).toContain('主角觉醒')
      expect(result.actProgress?.[1]?.consumed).not.toContain('主角觉醒')
    }
  )

  it(
    'consumes a mandatory beat when a state-class event corroborates it via a shared evidence anchor',
    { timeout: 60000 },
    async () => {
      const arc: StoryArcSpec = {
        totalChapters: 3,
        acts: [{ index: 1, startChapter: 1, endChapter: 3, mandatoryBeats: ['主角觉醒'] }],
      }
      const state = createInitialState(storyId, tmpDir, arc, true)
      setupStory(state)
      // 推进事件与状态类事件共享证据锚点 @p2 → 结构化痕迹成立；
      // 状态类事件须由章节规划授权（未授权的非 plot-advance 事件是硬错误）。
      scenarioEvents = [plotAdvanceEvent('evt-p1', 'A1-M1', 2), statusEvent('evt-s1', 2)]
      scenarioExpectedEvents = [{ ...statusEvent('evt-expected-s1', 2), source: 'outline' }]

      const result = await runOneChapter(
        storyId,
        { mode: 'draft', targetChapterIndex: 0 },
        createMockContext()
      )

      expect(result.currentChapterIndex).toBe(1)
      expect(result.storyMemory?.beats['A1-M1']?.corroboration?.status).toBe('consumed')
      expect(result.storyMemory?.beats['A1-M1']?.corroboration?.corroboratingEventIds).toContain(
        'evt-s1'
      )
      expect(result.actProgress?.[1]?.consumed).toContain('主角觉醒')
      // 全程不出现佐证类问题
      const allIssues = [...(result.chapterReport?.issues ?? []), ...(result.pendingIssues ?? [])]
      expect(allIssues.some((issue) => issue.type === 'beat_uncorroborated')).toBe(false)
    }
  )

  it(
    'blocks the act boundary when a mandatory beat closes the act uncorroborated',
    { timeout: 60000 },
    async () => {
      const arc: StoryArcSpec = {
        totalChapters: 2,
        acts: [
          { index: 1, startChapter: 1, endChapter: 1, mandatoryBeats: ['主角觉醒'] },
          { index: 2, startChapter: 2, endChapter: 2, mandatoryBeats: ['终局对决'] },
        ],
      }
      // 大纲不认领：推进事件作为未认领但经验证的进展被接受，章节进入定稿，
      // 由幕关闭质量复审把关（D.2.2）。
      const state = createInitialState(storyId, tmpDir, arc, false)
      setupStory(state)
      scenarioEvents = [plotAdvanceEvent('evt-p1', 'A1-M1', 2)]

      const result = await runOneChapter(
        storyId,
        { mode: 'draft', targetChapterIndex: 0 },
        createMockContext()
      )

      // 幕关闭质量复审：未佐证的 mandatory beat 回到 pending，幕不得关闭
      expect(result.currentChapterIndex).toBe(0)
      expect(result.rewriteRequested).toBe(true)
      const boundaryIssue = (result.pendingIssues ?? []).find(
        (issue) => issue.ruleId === 'outline-coverage.pending-beats-at-boundary'
      )
      expect(boundaryIssue).toBeDefined()
      expect(boundaryIssue?.description).toContain('A1-M1')
      expect(boundaryIssue?.description).toContain('佐证审计')
    }
  )
})
