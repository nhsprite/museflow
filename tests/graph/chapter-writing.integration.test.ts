import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runOneChapter } from '../../src/core/runner.js'
import { createEmptyStoryState } from '../../src/storage/meta/stores/story-state.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { ChapterPlan } from '../../src/agents/chapter-planner.js'
import type { Issue } from '../../src/types/agent.js'

let tmpDir: string

vi.mock('../../src/model/registry.js', () => ({
  createProvider: vi.fn(() => {
    throw new Error('createProvider should not be called in chapter integration tests')
  }),
  AnthropicCompatibleProvider: class {},
}))

vi.mock('../../src/core/outline-expander.js', () => ({
  expandOutlineForChapter: vi.fn(async (_state: ReducedGraphState, chapterIndex: number) => ({
    chapterPlan: {
      chapterNumber: chapterIndex + 1,
      sections: [
        { title: '开端', summary: '主角出场', wordCount: 2000, events: ['主角出场'], characters: ['主角'] },
      ],
      timeline: [],
      outlineCheck: [],
    } as ChapterPlan,
    boundaryHints: [],
    pendingIssues: [],
  })),
}))

vi.mock('../../src/graph/utils/reconciler.js', () => ({
  prepareStoryStateForChapter: vi.fn(async (state: ReducedGraphState) => ({
    reconciledState: state.storyState ?? createEmptyStoryState(),
    stateConflicts: '',
    itemLocationConflicts: [],
  })),
  formatStoryState: vi.fn(() => ''),
  buildCharacterFactTimeline: vi.fn(() => ''),
  mergeStoryState: vi.fn((existing: unknown, update: unknown) => ({ ...(existing as object), ...(update as object) })),
}))

const longChapterContent = '# 第1章 测试章节\n\n' + '主角走在路上，心中思绪万千。'.repeat(800)

const mockChapterAgent = {
  run: vi.fn(async () => ({
    success: true,
    content: longChapterContent,
    data: { preWriteCheck: 'checked' },
  })),
}

const mockQualityAgent = {
  run: vi.fn(async () => ({ success: true, content: '', data: { issues: [] } })),
  processOutput: vi.fn(async () => ({ issues: [] as Issue[] })),
}

const mockForeshadowingAgent = {
  run: vi.fn(async () => ({ success: true, content: '', data: { planted: [], fulfilled: [] } })),
  processOutput: vi.fn(async (_output: unknown, _chapterIndex: number, existingStack: unknown) => existingStack),
}

const mockHallucinationAgent = {
  run: vi.fn(async () => ({ success: true, content: '', data: { issues: [] } })),
  processOutput: vi.fn(async () => [] as Issue[]),
}

const mockConsistencyAgent = {
  run: vi.fn(async () => ({ success: true, content: '', data: { issues: [] } })),
  processOutput: vi.fn(async () => [] as Issue[]),
}

const mockOutlineComplianceAgent = {
  run: vi.fn(async () => ({ success: true, content: '', data: { isCompliant: true, issues: [] } })),
  processOutput: vi.fn(async () => ({ isCompliant: true, issues: [] as Issue[] })),
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
  getQualityAgent: () => mockQualityAgent,
  getForeshadowingAgent: () => mockForeshadowingAgent,
  getHallucinationAgent: () => mockHallucinationAgent,
  getConsistencyAgent: () => mockConsistencyAgent,
  getOutlineComplianceAgent: () => mockOutlineComplianceAgent,
  getFixAgent: () => mockFixAgent,
  getSummaryAgent: () => mockSummaryAgent,
}))

function createInitialState(storyId: string, outputDir: string, totalChapters: number): ReducedGraphState {
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
      { id: 'char-1', storyId, name: '主角', description: null, dialogueStyle: null, createdAt: Date.now() },
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
    autoFixAttempts: 0,
    verifiedConstraints: [],
    chapterReport: null,
    rewriteAttempts: 0,
    errorRewriteAttempts: 0,
    previousIssues: [],
    previousRawErrorCount: 0,
    forceStructuralRewrite: false,
    routingDecision: undefined,
    authorDecisions: {},
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
  writeFileSync(join(checkpointDir, 'latest.json'), JSON.stringify({ checkpointId, ts: checkpoint.checkpoint.ts }), 'utf-8')
}

describe('chapter writing integration', () => {
  beforeEach(() => {
    tmpDir = join(process.cwd(), 'books', `chapter-writing-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('drafts and finalizes a single chapter end-to-end', { timeout: 60000 }, async () => {
    const totalChapters = 3
    const storyId = 'story_test_chapter_writing'
    const state = createInitialState(storyId, tmpDir, totalChapters)
    writeFileSync(join(tmpDir, 'meta.json'), JSON.stringify({ story: state.story }), 'utf-8')
    writeInitialCheckpoint(tmpDir, state)

    const result = await runOneChapter(storyId, { mode: 'draft', targetChapterIndex: 0 })

    expect(result.currentChapterIndex).toBe(1)
    expect(result.chapters[0]).not.toBeNull()
    expect(result.chapters[0]?.number).toBe(1)
    expect(result.pendingIssues.filter(i => i.severity === 'error')).toHaveLength(0)

    const chapterFile = join(tmpDir, 'chapters', 'chapter_1.md')
    expect(existsSync(chapterFile)).toBe(true)
    const content = readFileSync(chapterFile, 'utf-8')
    expect(content.length).toBeGreaterThan(0)

    const checkpointsDir = join(tmpDir, 'checkpoints')
    expect(existsSync(join(checkpointsDir, 'latest.json'))).toBe(true)
    expect(existsSync(join(checkpointsDir, 'chapter_1_done.json'))).toBe(true)
  })
})
