import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runOneChapter } from '../../src/core/runner.js'
import { createEmptyStoryState } from '../../src/storage/meta/stores/story-state.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { ChapterPlan } from '../../src/agents/chapter-planner.js'
import type { Issue } from '../../src/types/agent.js'
import type { ChapterSession } from '../../src/core/chapter-generation/routing/types.js'
import type { ModelProvider } from '../../src/model/provider.js'
import type { RuntimeContext } from '../../src/core/context.js'
import { JsonCheckpointer } from '../../src/graph/checkpointer.js'

let tmpDir: string
let storyId: string

const mockChat = vi.fn(async (): Promise<string> => '')
const mockChatStructured = vi.fn().mockResolvedValue({})

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

vi.mock('../../src/core/outline-expander.js', () => ({
  expandOutlineForChapter: vi.fn(async (_state: ReducedGraphState, chapterIndex: number) => ({
    chapterPlan: {
      chapterNumber: chapterIndex + 1,
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
    } as ChapterPlan,
    boundaryHints: [],
    pendingIssues: [],
  })),
}))

vi.mock('../../src/graph/utils/reconciler/index.js', () => ({
  prepareStoryStateForChapter: vi.fn(async (state: ReducedGraphState) => ({
    reconciledState: state.storyState ?? createEmptyStoryState(),
    stateConflicts: '',
    itemLocationConflicts: [],
  })),
  formatStoryState: vi.fn(() => ''),
  buildCharacterFactTimeline: vi.fn(() => ''),
  mergeStoryState: vi.fn((existing: unknown, update: unknown) => ({
    ...(existing as object),
    ...(update as object),
  })),
}))

const longChapterContent = '# 第1章 测试章节\n\n' + '主角走在路上，心中思绪万千。'.repeat(600)

const mockChapterAgent = {
  run: vi.fn(async () => ({
    success: true,
    content: longChapterContent,
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
  run: vi.fn(async () => ({ success: true, content: '本章摘要', data: {} })),
  processOutput: vi.fn(() => ({ summary: '本章摘要', storyState: undefined })),
}

const mockFixAgent = {
  run: vi.fn(async () => ({ success: true, content: '', data: {} })),
  processOutput: vi.fn(() => ({ content: longChapterContent, chapterMeta: null })),
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
    chapterTimeAnchor: undefined,
    verifiedConstraints: [],
    chapterReport: null,
    authorDecisions: {},
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

describe('chapter writing integration', () => {
  beforeEach(() => {
    storyId = `story_test_chapter_writing_${randomUUID().slice(0, 8)}`
    const shortId = storyId.split('_').pop()?.slice(0, 12).toLowerCase() ?? storyId
    tmpDir = join(process.cwd(), 'books', `chapter-writing-${shortId}-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('drafts and finalizes a single chapter end-to-end', { timeout: 60000 }, async () => {
    const totalChapters = 3
    const state = createInitialState(storyId, tmpDir, totalChapters)
    writeFileSync(join(tmpDir, 'meta.json'), JSON.stringify({ story: state.story }), 'utf-8')
    writeInitialCheckpoint(tmpDir, state)

    const result = await runOneChapter(
      storyId,
      { mode: 'draft', targetChapterIndex: 0 },
      createMockContext()
    )

    expect(result.currentChapterIndex).toBe(1)
    expect(result.chapters[0]).not.toBeNull()
    expect(result.chapters[0]?.number).toBe(1)
    expect(result.pendingIssues.filter((i) => i.severity === 'error')).toHaveLength(0)

    const chapterFile = join(tmpDir, 'chapters', 'chapter_1.md')
    expect(existsSync(chapterFile)).toBe(true)
    const content = readFileSync(chapterFile, 'utf-8')
    expect(content.length).toBeGreaterThan(0)

    const checkpointsDir = join(tmpDir, 'checkpoints')
    expect(existsSync(join(checkpointsDir, 'latest.json'))).toBe(true)
    expect(existsSync(join(checkpointsDir, 'chapter_markers.json'))).toBe(true)
    const markers = JSON.parse(readFileSync(join(checkpointsDir, 'chapter_markers.json'), 'utf-8'))
    expect(markers['1']).toBeDefined()
    expect(existsSync(join(checkpointsDir, `${markers['1']}.json`))).toBe(true)
  })
})
