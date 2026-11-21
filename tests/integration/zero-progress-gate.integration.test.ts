import { passingNarrativeAuditResponse } from '../utils/narrative-audit.js'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runOneChapter } from '../../src/core/runner.js'
import { createEmptyStoryState } from '../../src/storage/meta/stores/story-state.js'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { ChapterPlan } from '../../src/agents/chapter-planner.js'
import type { Issue } from '../../src/types/agent.js'
import type { ChapterSession } from '../../src/core/chapter-generation/routing/types.js'
import type { ZeroProgressRejection } from '../../src/agents/types.js'
import type { ModelProvider } from '../../src/model/provider.js'
import type { RuntimeContext } from '../../src/core/context.js'
import { JsonCheckpointer } from '../../src/graph/checkpointer.js'

/**
 * 跨章零增量闸集成测试（C.2.2）：mock provider 连续产出零事件章节，
 * 验证第 1 章 warning 定稿、第 2 章升级为 error 并转向大纲重生成而非定稿。
 */

let tmpDir: string
let testRoot: string
let storyId: string
let recording: 'not_required' | 'uncertain' = 'uncertain'

vi.mock('../../src/utils/paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/paths.js')>()),
  getOutputsDir: () => testRoot,
}))

const mockChat = vi.fn(async (): Promise<string> => '')
const mockChatStructured = vi.fn().mockImplementation(async (_messages, schema) => {
  if (Object.hasOwn(schema.properties, 'isContinuous')) return { isContinuous: true }
  return {}
})

function createMockProvider(): ModelProvider {
  return {
    chat: mockChat,
    chatStructured: async (...args) => {
      const response = passingNarrativeAuditResponse(args[0], args[1]) as any
      if (response?.progress)
        response.progress = response.progress.map((chapter: object) => ({ ...chapter, recording }))
      return response ?? mockChatStructured(...args)
    },
  }
}

function createMockContext(): RuntimeContext {
  return {
    provider: createMockProvider(),
    checkpointer: new JsonCheckpointer(),
    config: { model: { provider: 'openai', model: 'gpt-4o', temperature: 0.7, maxTokens: 8192 } },
  }
}

const expandOutlineForChapterMock = vi.hoisted(() =>
  vi.fn(async (_state: unknown, chapterIndex: number) => ({
    chapterPlan: {
      chapterIndex,
      sections: [
        {
          title: '开端',
          summary: '主角出场',
          wordCount: 2000,
          events: ['主角出场'],
          characters: ['主角'],
        },
      ],
      timeline: [],
      outlineCheck: [],
      expectedEvents: [],
      claimedBeatIds: [],
      fulfilledForeshadowIds: [],
      introducedForeshadowIds: [],
      resolvedTaskIds: [],
      createdTaskIds: [],
    } as ChapterPlan,
    boundaryHints: [],
    pendingIssues: [],
  }))
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

// 章节正文达标但完全不含结构化事件：典型的注水章。
// 每次起草使用不同文本，避免触发跨章结尾重复检查（与零增量判定无关的干扰项）。
let draftCounter = 0
function nextChapterContent(): string {
  draftCounter += 1
  return `# 第1章 测试章节\n\n` + `主角沿着第${draftCounter}条小路前行，心中思绪万千。`.repeat(400)
}

const mockChapterAgent = {
  run: vi.fn(async () => ({
    success: true,
    content: nextChapterContent(),
    data: { preWriteCheck: 'checked' },
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

function createInitialState(
  storyId: string,
  outputDir: string,
  totalChapters: number
): ReducedGraphState {
  return {
    story: {
      id: storyId,
      title: '测试故事',
      outputDir,
      genre: 'default',
      totalChapters,
      status: 'outlining',
      provider: 'openai',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    idea: '一个测试故事',
    genre: 'default',
    totalChapters,
    world: { id: 'world-1', storyId, content: '测试世界观' },
    characters: [
      {
        id: 'char-1',
        storyId,
        name: '主角',
        description: null,
        dialogueStyle: null,
        createdAt: Date.now(),
      },
    ],
    outline: Array.from({ length: totalChapters }, (_, i) => ({
      id: `outline-${i}`,
      number: i + 1,
      title: `第${i + 1}章`,
      description: `第${i + 1}章的核心事件。`,
      introducedCharacters: i === 0 ? ['主角'] : [],
    })),
    chapters: Array(totalChapters).fill(null),
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

describe('zero-progress density gate integration (C.2.2)', () => {
  beforeEach(() => {
    storyId = `story_test_zero_progress_${randomUUID().slice(0, 8)}`
    const shortId = storyId.split('_').pop()?.slice(0, 12).toLowerCase() ?? storyId
    testRoot = mkdtempSync(join(tmpdir(), 'museflow-progress-gate-'))
    tmpDir = join(testRoot, `zero-progress-${shortId}-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    recording = 'uncertain'
    draftCounter = 0
    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true })
  })

  it(
    'commits quiet progress across checkpoints, then starts a new zero-increment streak',
    { timeout: 60000 },
    async () => {
      recording = 'not_required'
      const state = createInitialState(storyId, tmpDir, 5)
      writeFileSync(join(tmpDir, 'meta.json'), JSON.stringify({ story: state.story }))
      writeInitialCheckpoint(tmpDir, state)
      for (const targetChapterIndex of [0, 1]) {
        const result = await runOneChapter(
          storyId,
          { mode: 'draft', targetChapterIndex },
          createMockContext()
        )
        expect(result.currentChapterIndex).toBe(targetChapterIndex + 1)
        expect(result.consecutiveZeroIncrementChapters).toBe(0)
        expect(result.storyMemory?.events).toEqual([])
        expect(result.chapterReport?.narrativeAudit?.progress.at(-1)?.recording).toBe(
          'not_required'
        )
        expect(
          result.chapterReport?.issues.some(
            (issue) => issue.ruleId === 'structured.zero-increment-chapter'
          )
        ).toBe(false)
        expect(existsSync(join(tmpDir, 'chapters', `chapter_${targetChapterIndex + 1}.md`))).toBe(
          true
        )
      }
      // 未取得非状态推进凭证的下一章，不能继承之前的放行资格，也不能继承旧连击。
      recording = 'uncertain'
      const third = await runOneChapter(
        storyId,
        { mode: 'draft', targetChapterIndex: 2 },
        createMockContext()
      )
      expect(third.currentChapterIndex).toBe(3)
      expect(third.consecutiveZeroIncrementChapters).toBe(1)
      expect(third.chapterReport?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'structured.zero-increment-chapter',
            severity: 'warning',
          }),
        ])
      )
    }
  )

  it(
    'finalizes the first zero-event chapter with warnings, then escalates the second to outline regeneration instead of finalize',
    {
      timeout: 60000,
    },
    async () => {
      const totalChapters = 3
      const state = createInitialState(storyId, tmpDir, totalChapters)
      writeFileSync(join(tmpDir, 'meta.json'), JSON.stringify({ story: state.story }), 'utf-8')
      writeInitialCheckpoint(tmpDir, state)

      // 第 1 章：零事件、零增量 → warning 进章节报告，正常定稿，连击计数 +1
      const first = await runOneChapter(
        storyId,
        { mode: 'draft', targetChapterIndex: 0 },
        createMockContext()
      )

      expect(first.currentChapterIndex).toBe(1)
      expect(first.consecutiveZeroIncrementChapters).toBe(1)
      const firstReportIssues = first.chapterReport?.issues ?? []
      expect(
        firstReportIssues.some(
          (issue) =>
            issue.ruleId === 'structured.zero-event-chapter' && issue.severity === 'warning'
        )
      ).toBe(true)
      expect(
        firstReportIssues.some(
          (issue) =>
            issue.ruleId === 'structured.zero-increment-chapter' && issue.severity === 'warning'
        )
      ).toBe(true)
      expect(existsSync(join(tmpDir, 'chapters', 'chapter_1.md'))).toBe(true)

      // 第 2 章：连续第 2 个零增量章 → 不得定稿；routing 转向大纲重生成，
      // 重生成次数耗尽后停在 zero_progress_stall 阻断报告。
      const second = await runOneChapter(
        storyId,
        { mode: 'draft', targetChapterIndex: 1 },
        createMockContext()
      )

      expect(second.currentChapterIndex).toBe(1)
      expect(second.blockingReport?.reason).toBe('zero_progress_stall')
      // 未定稿：连击计数不归零也不增加
      expect(second.consecutiveZeroIncrementChapters).toBe(1)

      // 大纲重生成携带 ZeroProgressRejection（含最近章节事件计数）
      const regenCalls = expandOutlineForChapterMock.mock.calls.filter(
        (call) =>
          (call[3] as { zeroProgressRejection?: ZeroProgressRejection } | undefined)
            ?.zeroProgressRejection !== undefined
      )
      expect(regenCalls.length).toBeGreaterThanOrEqual(1)
      const rejection = (regenCalls[0]?.[3] as { zeroProgressRejection: ZeroProgressRejection })
        .zeroProgressRejection
      expect(rejection.consecutiveZeroIncrementChapters).toBe(2)
      expect(rejection.recentChapterEventCounts).toEqual([
        { chapterIndex: 0, acceptedEventCount: 0 },
        { chapterIndex: 1, acceptedEventCount: 0 },
      ])
    }
  )
})
