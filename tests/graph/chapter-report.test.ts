import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { finalize_chapter } from '../../src/graph/nodes/finalization.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { Issue } from '../../src/types/agent.js'
import type { ChapterSession } from '../../src/core/chapter-generation/routing/types.js'
import { createEmptyStoryState } from '../../src/storage/meta/stores/story-state.js'
import { processSummaryOutput } from '../../src/agents/index.js'
import type { ModelProvider } from '../../src/model/provider.js'
import type { RuntimeContext } from '../../src/core/context.js'

const { loadConfigMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn(() => ({
    model: { provider: 'openai' as const, model: 'gpt-4o' },
    autoAdjustActBoundaries: false,
  })),
}))

vi.mock('../../src/config/store.js', () => ({
  loadConfig: loadConfigMock,
}))

vi.mock('../../src/graph/agent-factory.js', () => ({
  getSummaryAgent: vi.fn().mockReturnValue({
    run: vi.fn().mockResolvedValue({
      success: true,
      data: {
        summary: '主角离开家乡，踏上旅途。',
        characterLocations: { 主角: '路上' },
        keyItemsLocation: { 护身符: '主角身上' },
      },
    }),
  }),
}))

vi.mock('../../src/agents/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/agents/index.js')>(
    '../../src/agents/index.js'
  )
  return {
    ...actual,
    processSummaryOutput: vi.fn().mockReturnValue({
      summary: '主角离开家乡，踏上旅途。',
      storyState: {
        characterLocations: { 主角: '路上' },
        keyItemsLocation: { 护身符: '主角身上' },
        currentScene: '官道',
        storyTime: '清晨',
      },
    }),
  }
})

vi.mock('../../src/graph/checkpointer.js', () => ({
  getCheckpointer: vi.fn().mockReturnValue({
    pruneIntermediateCheckpoints: vi.fn().mockResolvedValue(undefined),
    clearPendingWrites: vi.fn().mockResolvedValue(undefined),
    getTuple: vi.fn().mockResolvedValue(null),
  }),
}))

function createMockProvider(): ModelProvider {
  return { chat: vi.fn().mockResolvedValue(''), chatStructured: vi.fn().mockResolvedValue({}) }
}

function createMockContext(): RuntimeContext {
  return {
    provider: createMockProvider(),
    checkpointer: {
      getTuple: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue({} as never),
      list: vi.fn().mockResolvedValue([]),
      deleteThread: vi.fn().mockResolvedValue(undefined),
    } as unknown as RuntimeContext['checkpointer'],
    config: { model: { provider: 'openai', model: 'gpt-4o', temperature: 0.7, maxTokens: 8192 } },
  }
}

function buildSession(overrides: Partial<ChapterSession> = {}): ChapterSession {
  return {
    chapterIndex: 0,
    rewriteAttempts: 1,
    errorRewriteAttempts: 0,
    autoFixAttempts: 0,
    previousIssues: [],
    previousRawErrorCount: 0,
    routingDecision: 'draft_chapter',
    forceStructuralRewrite: false,
    rewriteApproved: false,
    ...overrides,
  }
}

function buildState(
  outputDir: string,
  overrides: Partial<ReducedGraphState> & { session?: Partial<ChapterSession> } = {}
): ReducedGraphState {
  const { session: sessionOverrides, ...rest } = overrides
  const base: ReducedGraphState = {
    story: { id: 'test-story', title: 'Test', outputDir, genre: 'default', totalChapters: 3 },
    idea: 'test idea',
    genre: 'default',
    totalChapters: 3,
    currentChapterIndex: 0,
    chapters: [
      {
        id: 'ch-1',
        storyId: 'test-story',
        number: 1,
        title: '启程',
        outline: '主角离开家乡。',
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
      { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
      { number: 3, title: '脱困', description: '主角脱困。' },
    ],
    storyArc: {
      totalChapters: 3,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 3,
          title: '启程',
          theme: '出发',
          function: '建立动机',
          mandatoryBeats: ['主角离开家乡'],
        },
      ],
      keyBeats: [],
    },
    actProgress: { 1: { consumed: [], pending: ['主角离开家乡'] } },
    characters: [
      {
        id: 'char-1',
        storyId: 'test-story',
        name: '主角',
        description: '主角',
        dialogueStyle: null,
        createdAt: 0,
      },
    ],
    world: null,
    storyState: createEmptyStoryState(),
    pendingIssues: [],
    verifiedConstraints: [],
    session: buildSession(sessionOverrides),
    ...rest,
  } as unknown as ReducedGraphState
  return base
}

describe('chapter report generation', () => {
  let tmpDir: string

  beforeEach(async () => {
    loadConfigMock.mockReturnValue({
      model: { provider: 'openai' as const, model: 'gpt-4o' },
      autoAdjustActBoundaries: false,
    })

    tmpDir = path.join(process.cwd(), 'tests', 'tmp', `chapter-report-${Date.now()}`)
    await fs.mkdir(path.join(tmpDir, 'chapters'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'chapters', 'chapter_1.md'),
      '# 第一章 启程\n\n主角告别了故乡，踏上了未知的旅途。他的护身符在怀中微微发热。\n\n远处传来马蹄声。',
      'utf-8'
    )
    await fs.writeFile(
      path.join(tmpDir, 'meta.json'),
      JSON.stringify({
        story: {
          id: 'test-story',
          title: 'Test',
          outputDir: tmpDir,
          genre: 'default',
          totalChapters: 3,
          status: 'writing',
          provider: 'openai',
          createdAt: 0,
          updatedAt: 0,
        },
        world: null,
        characters: [],
        outline: [],
        chapters: [],
      }),
      'utf-8'
    )
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('generates and saves a chapter report on finalize', async () => {
    const state = buildState(tmpDir)

    const result = await finalize_chapter(createMockContext(), state)

    expect(result.chapterReport).toBeDefined()
    expect(result.chapterReport!.chapterIndex).toBe(0)
    expect(result.chapterReport!.chapterTitle).toBe('启程')
    expect(result.chapterReport!.draftStrategy).toBe('draft')
    expect(result.chapterReport!.convergence).toBe('success')
    expect(result.chapterReport!.wordCount).toBeGreaterThan(0)

    const reportPath = path.join(tmpDir, 'reports', 'chapter_1.report.json')
    const exists = await fs
      .access(reportPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)

    const saved = JSON.parse(await fs.readFile(reportPath, 'utf-8'))
    expect(saved.storyId).toBe('test-story')
    expect(saved.chapterIndex).toBe(0)
    expect(saved.chapterTitle).toBe('启程')
    expect(saved.convergence).toBe('success')
  })

  it('records pending issues in the report', async () => {
    const issues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'warning', description: '时间线略紧凑' },
      { id: '2', type: 'hallucination', severity: 'warning', description: '描写略显突兀' },
    ]
    const state = buildState(tmpDir, { pendingIssues: issues })

    const result = await finalize_chapter(createMockContext(), state)

    expect(result.chapterReport).toBeDefined()
    expect(result.chapterReport!.issues).toHaveLength(2)
    expect(result.chapterReport!.issuesSummary.total).toBe(2)
    expect(result.chapterReport!.issuesSummary.errors).toBe(0)
    expect(result.chapterReport!.issuesSummary.warnings).toBe(2)
  })

  it('records foreshadow counts in the report', async () => {
    const state = buildState(tmpDir, {
      foreshadowStack: [
        {
          id: 'fs-1',
          text: '护身符发热',
          expectedFulfillChapter: 3,
          createdAt: 0,
          createdAtChapter: 1,
          status: 'planted',
          isExplicit: true,
        },
        {
          id: 'fs-2',
          text: '远处的马蹄声',
          expectedFulfillChapter: 1,
          createdAt: 0,
          createdAtChapter: 1,
          fulfilledChapter: 1,
          status: 'shown',
          isExplicit: false,
        },
      ],
    })

    const result = await finalize_chapter(createMockContext(), state)

    expect(result.chapterReport!.foreshadowsPlanted).toBe(2)
    expect(result.chapterReport!.foreshadowsFulfilled).toBe(1)
  })

  it('updates actProgress with verified beats only', async () => {
    const state = buildState(tmpDir, {
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。', claimedBeats: ['主角离开家乡'] },
        { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
        { number: 3, title: '脱困', description: '主角脱困。' },
      ],
    })
    vi.mocked(processSummaryOutput).mockReturnValueOnce({
      summary: '主角离开家乡。',
      storyState: createEmptyStoryState(),
      verifiedBeats: ['主角离开家乡'],
    })

    const result = await finalize_chapter(createMockContext(), state)

    expect(result.actProgress?.[1]?.consumed).toContain('主角离开家乡')
    expect(result.actProgress?.[1]?.pending).not.toContain('主角离开家乡')
    expect(result.outline?.[0]?.verifiedBeats).toEqual(['主角离开家乡'])
  })

  it('returns finalized state without mutating the input graph state', async () => {
    const state = buildState(tmpDir, {
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。', claimedBeats: ['主角离开家乡'] },
        { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
        { number: 3, title: '脱困', description: '主角脱困。' },
      ],
    })
    const originalOutline = structuredClone(state.outline)
    const originalChapterSummaries = [...state.chapterSummaries]
    const originalChapter = structuredClone(state.chapters[0])

    vi.mocked(processSummaryOutput).mockReturnValueOnce({
      summary: '主角离开家乡。',
      storyState: createEmptyStoryState(),
      verifiedBeats: ['主角离开家乡'],
    })

    const result = await finalize_chapter(createMockContext(), state)

    expect(result.outline?.[0]?.verifiedBeats).toEqual(['主角离开家乡'])
    expect(result.chapterSummaries).toEqual(['主角离开家乡。'])
    expect(state.outline).toEqual(originalOutline)
    expect(state.chapterSummaries).toEqual(originalChapterSummaries)
    expect(state.chapters[0]).toEqual(originalChapter)
  })

  it('stores evidence for verified mandatory beats', async () => {
    const state = buildState(tmpDir, {
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。', claimedBeats: ['主角离开家乡'] },
        { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
        { number: 3, title: '脱困', description: '主角脱困。' },
      ],
    })
    vi.mocked(processSummaryOutput).mockReturnValueOnce({
      summary: '主角离开家乡。',
      storyState: createEmptyStoryState(),
      verifiedBeats: ['主角离开家乡'],
      verifiedBeatEvidence: [
        {
          beat: '主角离开家乡',
          chapterIndex: 0,
          quote: '主角推开柴门，沿着官道离开家乡',
          confidence: 'high',
        },
      ],
    })

    const result = await finalize_chapter(createMockContext(), state)

    expect(result.outline?.[0]?.verifiedBeatEvidence).toEqual([
      {
        beat: '主角离开家乡',
        chapterIndex: 0,
        quote: '主角推开柴门，沿着官道离开家乡',
        confidence: 'high',
      },
    ])
    expect(result.actProgress?.[1]?.consumed).toContain('主角离开家乡')
  })

  it('adds warning issue when claimed beat is not verified', async () => {
    const state = buildState(tmpDir, {
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。', claimedBeats: ['主角离开家乡'] },
        { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
        { number: 3, title: '脱困', description: '主角脱困。' },
      ],
    })
    vi.mocked(processSummaryOutput).mockReturnValueOnce({
      summary: '主角还在家里收拾行李。',
      storyState: createEmptyStoryState(),
      verifiedBeats: [],
    })

    const result = await finalize_chapter(createMockContext(), state)

    expect(result.actProgress?.[1]?.consumed).not.toContain('主角离开家乡')
    const warning = result.pendingIssues?.find((i) => i.type === 'outline_coverage')
    expect(warning).toBeDefined()
    expect(warning?.description).toContain('主角离开家乡')
    expect(result.chapterReport?.issues.some((i) => i.type === 'outline_coverage')).toBe(true)
  })

  it('clears stale outline coverage warning when its beat becomes verified', async () => {
    const state = buildState(tmpDir, {
      pendingIssues: [
        {
          id: 'unverified-beat-1-0',
          type: 'outline_coverage',
          severity: 'warning',
          description:
            '本章大纲声称推进 mandatory beat「主角离开家乡」，但正文未验证到该 beat 的发生。',
        },
      ],
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。', claimedBeats: ['主角离开家乡'] },
        { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
        { number: 3, title: '脱困', description: '主角脱困。' },
      ],
    })
    vi.mocked(processSummaryOutput).mockReturnValueOnce({
      summary: '主角离开家乡。',
      storyState: createEmptyStoryState(),
      verifiedBeats: ['主角离开家乡'],
    })

    const result = await finalize_chapter(createMockContext(), state)

    expect(result.actProgress?.[1]?.consumed).toContain('主角离开家乡')
    expect(result.pendingIssues?.some((i) => i.id === 'unverified-beat-1-0')).toBe(false)
    expect(result.chapterReport?.issues.some((i) => i.id === 'unverified-beat-1-0')).toBe(false)
  })

  it('clears stale outline coverage warning from a past act', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'chapters', 'chapter_2.md'),
      '# 第二章 遇敌\n\n主角继续赶路，远处的马蹄声逼近。',
      'utf-8'
    )
    const state = buildState(tmpDir, {
      currentChapterIndex: 1,
      chapters: [
        {
          id: 'ch-1',
          storyId: 'test-story',
          number: 1,
          title: '启程',
          outline: '主角离开家乡。',
          summary: '主角离开家乡。',
          foreshadows: null,
          status: 'completed',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 'ch-2',
          storyId: 'test-story',
          number: 2,
          title: '遇敌',
          outline: '主角遭遇敌人。',
          summary: null,
          foreshadows: null,
          status: 'drafting',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      storyArc: {
        totalChapters: 3,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '启程',
            theme: '出发',
            function: '建立动机',
            mandatoryBeats: ['主角离开家乡'],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 3,
            title: '遇敌',
            theme: '对抗',
            function: '升级冲突',
            mandatoryBeats: ['反派首次施压'],
          },
        ],
        keyBeats: [],
      },
      actProgress: {
        1: { consumed: [], pending: ['主角离开家乡'] },
        2: { consumed: [], pending: ['反派首次施压'] },
      },
      pendingIssues: [
        {
          id: 'unverified-beat-1-0',
          type: 'outline_coverage',
          severity: 'warning',
          description:
            '本章大纲声称推进 mandatory beat「主角离开家乡」，但正文未验证到该 beat 的发生。',
        },
      ],
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。' },
        { number: 2, title: '遇敌', description: '反派首次施压。', claimedBeats: ['反派首次施压'] },
        { number: 3, title: '脱困', description: '主角脱困。' },
      ],
    })
    vi.mocked(processSummaryOutput).mockReturnValueOnce({
      summary: '反派首次施压。',
      storyState: createEmptyStoryState(),
      verifiedBeats: ['反派首次施压'],
    })

    const result = await finalize_chapter(createMockContext(), state)

    expect(result.pendingIssues?.some((i) => i.id === 'unverified-beat-1-0')).toBe(false)
    expect(result.chapterReport?.issues.some((i) => i.id === 'unverified-beat-1-0')).toBe(false)
  })

  it('syncs total chapters and empty slots when auto act extension shifts following acts', async () => {
    loadConfigMock.mockReturnValue({
      model: { provider: 'openai' as const, model: 'gpt-4o' },
      autoAdjustActBoundaries: true,
    })
    await fs.writeFile(
      path.join(tmpDir, 'chapters', 'chapter_2.md'),
      '# 第二章 遇敌\n\n主角继续赶路，远处的马蹄声逼近。',
      'utf-8'
    )
    const state = buildState(tmpDir, {
      story: {
        id: 'test-story',
        title: 'Test',
        outputDir: tmpDir,
        genre: 'default',
        totalChapters: 6,
      },
      totalChapters: 6,
      currentChapterIndex: 1,
      chapters: [
        {
          id: 'ch-1',
          storyId: 'test-story',
          number: 1,
          title: '启程',
          outline: '主角离开家乡。',
          summary: '主角离开家乡。',
          foreshadows: null,
          status: 'completed',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 'ch-2',
          storyId: 'test-story',
          number: 2,
          title: '遇敌',
          outline: '主角遭遇敌人。',
          summary: null,
          foreshadows: null,
          status: 'drafting',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。' },
        { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
        { number: 3, title: '脱困', description: '主角脱困。' },
        { number: 4, title: '反击', description: '' },
        { number: 5, title: '追查', description: '' },
        { number: 6, title: '转折', description: '' },
      ],
      storyArc: {
        totalChapters: 6,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 3,
            title: '启程',
            theme: '出发',
            function: '建立动机',
            mandatoryBeats: ['主角离开家乡', '反派首次施压'],
          },
          {
            index: 2,
            startChapter: 4,
            endChapter: 6,
            title: '反击',
            theme: '对抗',
            function: '升级冲突',
            mandatoryBeats: ['主角反击'],
          },
        ],
        keyBeats: [],
      },
      actProgress: { 1: { consumed: [], pending: ['主角离开家乡', '反派首次施压'] } },
    })

    const result = await finalize_chapter(createMockContext(), state)

    expect(result.storyArc?.totalChapters).toBe(8)
    expect(result.totalChapters).toBe(8)
    expect(result.story?.totalChapters).toBe(8)
    expect(result.outline).toHaveLength(8)
    expect(result.chapters).toHaveLength(8)
    expect(result.storyArc?.acts.map((act) => [act.startChapter, act.endChapter])).toEqual([
      [1, 5],
      [6, 8],
    ])
  })
})
