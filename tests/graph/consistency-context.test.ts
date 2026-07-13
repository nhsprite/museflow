import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { ModelProvider } from '../../src/model/provider.js'
import type { RuntimeContext } from '../../src/core/context.js'

const testTempDir = join(tmpdir(), `museflow-consistency-context-${randomUUID().slice(0, 8)}`)

function createMockProvider(): ModelProvider {
  return {
    chat: vi.fn().mockResolvedValue(''),
    chatStructured: vi.fn().mockImplementation(async (messages: Array<{ content?: string }>) => {
      capturedContinuityPrompt = messages.map((m) => m.content ?? '').join('\n')
      return continuityCheckResponse
    }),
  }
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
let capturedStoryState = ''
let capturedOutline = ''
let capturedTimelineSnapshot = ''
let capturedPreviousChapters = ''
let capturedContinuityPrompt = ''
let capturedIssues: unknown[] = []
let capturedForeshadowStack: unknown[] = []
let consistencyOutput = { success: true, data: { is_consistent: true, issues: [] } }
let continuityCheckResponse: unknown = { isContinuous: true }

const { readChapterContentMock, foreshadowRunMock, foreshadowProcessOutputMock } = vi.hoisted(
  () => ({
    readChapterContentMock: vi.fn(),
    foreshadowRunMock: vi.fn(),
    foreshadowProcessOutputMock: vi.fn(),
  })
)

vi.mock('../../src/agents/index.js', () => ({
  WorldbuilderAgent: class {},
  CharacterAgent: class {},
  OutlineAgent: class {},
  ChapterAgent: class {},
  ChapterPlannerAgent: class {},
  ForeshadowingAgent: class {
    async run(state: unknown) {
      return foreshadowRunMock(state)
    }

    processOutput(output: unknown, chapterIndex: number, existingStack: unknown[]) {
      return foreshadowProcessOutputMock(output, chapterIndex, existingStack)
    }
  },
  ConsistencyAgent: class {
    async run(state: {
      storyState?: string
      outline?: string
      timelineSnapshot?: string
      previousChapters?: string
      issues?: unknown[]
      foreshadowStack?: unknown[]
    }) {
      capturedStoryState = state.storyState ?? ''
      capturedOutline = state.outline ?? ''
      capturedTimelineSnapshot = state.timelineSnapshot ?? ''
      capturedPreviousChapters = state.previousChapters ?? ''
      capturedIssues = state.issues ?? []
      capturedForeshadowStack = state.foreshadowStack ?? []
      return consistencyOutput
    }

    processOutput(output: { data?: { issues?: unknown[] } }) {
      return output.data?.issues ?? []
    }
  },
  FixAgent: class {},
  SummaryAgent: class {},
  processSummaryOutput: vi.fn(),
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  readChapterContent: readChapterContentMock,
  readChapterContentForRun: readChapterContentMock,
  writeChapterContent: vi.fn().mockResolvedValue(undefined),
  writeOutlineContent: vi.fn(),
  writeStoryBible: vi.fn(),
}))

vi.mock('../../src/graph/utils/reconciler/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/graph/utils/reconciler/index.js')>()
  return {
    ...actual,
    prepareStoryStateForChapter: vi.fn(async (state: ReducedGraphState) => ({
      reconciledState: state.storyState ?? {
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
      stateConflicts: '',
      itemLocationConflicts: [],
    })),
  }
})

describe('detect_consistency validation context', () => {
  function buildBaseState(): Parameters<typeof detect_consistency>[0] {
    return {
      story: { id: 'story-1', title: '测试', outputDir: testTempDir },
      idea: 'test',
      genre: 'default',
      totalChapters: 3,
      world: null,
      characters: [
        {
          id: 'character-1',
          storyId: 'story-1',
          name: '林黛玉',
          description: null,
          dialogueStyle: null,
          createdAt: 0,
        },
      ],
      outline: [
        { number: 1, title: '第一章', description: '林黛玉辨认真伪，识破假宝玉。' },
        { number: 2, title: '第二章', description: '后续。' },
        { number: 3, title: '第三章', description: '结局。' },
      ],
      chapters: [
        {
          id: 'chapter-1',
          storyId: 'story-1',
          number: 1,
          title: null,
          outline: null,
          summary: null,
          foreshadows: null,
          status: 'drafting',
          createdAt: 0,
          updatedAt: 0,
        },
        null,
        null,
      ],
      currentChapterIndex: 0,
      foreshadowStack: [],
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
      autoFixAttempts: 0,
    }
  }

  beforeEach(() => {
    capturedStoryState = ''
    capturedOutline = ''
    capturedTimelineSnapshot = ''
    capturedPreviousChapters = ''
    capturedContinuityPrompt = ''
    capturedIssues = []
    capturedForeshadowStack = []
    consistencyOutput = { success: true, data: { is_consistent: true, issues: [] } }
    continuityCheckResponse = { isContinuous: true }
    vi.clearAllMocks()
    readChapterContentMock.mockResolvedValue('正文内容')
    foreshadowRunMock.mockResolvedValue({
      success: true,
      data: { new_foreshadows: [], fulfilled_foreshadows: [], overdue_foreshadows: [] },
    })
    foreshadowProcessOutputMock.mockImplementation(
      (_output: unknown, _chapterIndex: number, existingStack: unknown[]) => existingStack
    )
  })

  it('passes canonical facts to consistency agent', async () => {
    const { detect_consistency } = await import('../../src/graph/nodes/validation.js')

    const state = buildBaseState()
    state.storyState.canonicalFacts = [
      { id: 'cf1', subject: '木之灵物', attribute: '所在位置', value: '昆仑山', establishedIn: 1 },
    ]

    await detect_consistency(createMockContext(), state)
    expect(capturedStoryState).toContain('【权威事实】')
    expect(capturedStoryState).toContain('木之灵物')
    expect(capturedStoryState).toContain('昆仑山')
  })

  it('does not expose current-chapter new foreshadows to the same consistency pass or persist them on errors', async () => {
    const { validate_chapter_comprehensive } = await import('../../src/graph/nodes/validation.js')

    const existingForeshadow = {
      id: 'fs-existing',
      text: '既有伏笔',
      expectedFulfillChapter: 3,
      createdAt: 0,
      createdAtChapter: 1,
      status: 'planted' as const,
      isExplicit: false,
      required: true,
    }
    const currentDraftForeshadow = {
      id: 'fs-current',
      text: '当前草稿刚抽取出的伏笔',
      expectedFulfillChapter: 4,
      createdAt: 0,
      createdAtChapter: 1,
      status: 'planted' as const,
      isExplicit: false,
      required: true,
    }
    foreshadowProcessOutputMock.mockImplementation(
      (_output: unknown, _chapterIndex: number, existingStack: unknown[]) => [
        ...existingStack,
        currentDraftForeshadow,
      ]
    )
    consistencyOutput = {
      success: true,
      data: {
        is_consistent: false,
        issues: [
          {
            id: 'consistency-error',
            type: 'consistency',
            severity: 'error',
            description: '当前章仍有严重问题',
            dimension: 'outline',
          },
        ],
      },
    }
    readChapterContentMock.mockResolvedValue('这是足够长的正文内容。'.repeat(500))

    const state = buildBaseState()
    state.foreshadowStack = [existingForeshadow]

    const result = await validate_chapter_comprehensive(createMockContext(), state)

    expect(capturedForeshadowStack).toEqual([existingForeshadow])
    expect(capturedForeshadowStack).not.toContain(currentDraftForeshadow)
    expect(result.pendingIssues).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: 'error' })])
    )
    expect(result.foreshadowStack).toBeUndefined()
  })

  it('keeps summary prose in previousChapters while providing canonical facts separately', async () => {
    const { detect_consistency } = await import('../../src/graph/nodes/validation.js')

    const state = buildBaseState()
    state.currentChapterIndex = 2
    state.chapters[2] = {
      id: 'chapter-3',
      storyId: 'story-1',
      number: 3,
      title: null,
      outline: null,
      summary: null,
      foreshadows: null,
      status: 'drafting',
      createdAt: 0,
      updatedAt: 0,
    }
    state.chapters[0]!.summary = '第1章摘要：林黛玉在东方灵河旧址暂住'
    state.chapters[1] = {
      id: 'chapter-2',
      storyId: 'story-1',
      number: 2,
      title: null,
      outline: null,
      summary: '第2章摘要：林黛玉抵达昆仑山',
      foreshadows: null,
      status: 'done',
      createdAt: 0,
      updatedAt: 0,
    }
    state.storyState.canonicalFacts = [
      {
        id: 'cf1',
        subject: '林黛玉',
        attribute: 'location',
        value: '昆仑山',
        establishedIn: 1,
      },
    ]

    await detect_consistency(createMockContext(), state)
    expect(capturedStoryState).toContain('【权威事实】')
    expect(capturedStoryState).toContain('昆仑山')
    // 摘要散文原样进入 previousChapters；timeline 只来自结构化权威事实，
    // 不再从摘要二次提取。
    expect(capturedPreviousChapters).toContain('东方灵河旧址')
    expect(capturedTimelineSnapshot).toContain('昆仑山')
    expect(capturedTimelineSnapshot).not.toContain('东方灵河旧址')
  })

  it('passes authoritative story state instead of only the reconciled state', async () => {
    const { detect_consistency } = await import('../../src/graph/nodes/validation.js')

    await detect_consistency(createMockContext(), {
      story: { id: 'story-1', title: '测试', outputDir: testTempDir },
      idea: 'test',
      genre: 'default',
      totalChapters: 3,
      world: null,
      characters: [
        {
          id: 'character-1',
          storyId: 'story-1',
          name: '林黛玉',
          description: null,
          dialogueStyle: null,
          createdAt: 0,
        },
      ],
      outline: [
        { number: 1, title: '第一章', description: '林黛玉辨认真伪，识破假宝玉。' },
        { number: 2, title: '第二章', description: '后续。' },
        { number: 3, title: '第三章', description: '结局。' },
      ],
      chapters: [
        {
          id: 'chapter-1',
          storyId: 'story-1',
          number: 1,
          title: null,
          outline: null,
          summary: null,
          foreshadows: null,
          status: 'drafting',
          createdAt: 0,
          updatedAt: 0,
        },
        null,
        null,
      ],
      currentChapterIndex: 0,
      foreshadowStack: [],
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
        characterLocations: {
          林黛玉: '昆仑山脚',
        },
        characterStatus: {},
        keyItemsLocation: {},
        keyItemsState: {},
        activePlots: [],
        revealedSecrets: [],
        pendingTasks: [],
        currentScene: '山路',
        storyTime: '当夜',
      },
      autoFixAttempts: 0,
    })

    expect(capturedStoryState).toContain('昆仑山脚')
  })

  it('redacts future chapter descriptions from consistency outline context', async () => {
    const { detect_consistency } = await import('../../src/graph/nodes/validation.js')

    await detect_consistency(createMockContext(), {
      story: { id: 'story-1', title: '测试', outputDir: testTempDir },
      idea: 'test',
      genre: 'default',
      totalChapters: 5,
      world: null,
      characters: [
        {
          id: 'character-1',
          storyId: 'story-1',
          name: '林黛玉',
          description: null,
          dialogueStyle: null,
          createdAt: 0,
        },
      ],
      outline: [
        { number: 1, title: '第一章', description: '黛玉启程。' },
        { number: 2, title: '第二章', description: '途中遇险。' },
        { number: 3, title: '第三章', description: '真相揭露。' },
        { number: 4, title: '第四章', description: '未来转折。' },
        { number: 5, title: '第五章', description: '结局。' },
      ],
      chapters: [
        {
          id: 'chapter-1',
          storyId: 'story-1',
          number: 1,
          title: null,
          outline: null,
          summary: null,
          foreshadows: null,
          status: 'drafting',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 'chapter-2',
          storyId: 'story-1',
          number: 2,
          title: null,
          outline: null,
          summary: null,
          foreshadows: null,
          status: 'drafting',
          createdAt: 0,
          updatedAt: 0,
        },
        null,
        null,
        null,
      ],
      currentChapterIndex: 1,
      foreshadowStack: [],
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
      autoFixAttempts: 0,
    })

    expect(capturedOutline).toContain('第一章')
    expect(capturedOutline).toContain('黛玉启程')
    expect(capturedOutline).toContain('第二章')
    expect(capturedOutline).toContain('途中遇险')
    expect(capturedOutline).toContain('第三章')
    expect(capturedOutline).not.toContain('真相揭露')
    expect(capturedOutline).toContain('后续章节内容已隐藏')
    expect(capturedOutline).not.toContain('未来转折')
    expect(capturedOutline).not.toContain('结局')
  })

  it('passes the previous chapter ending as continuity context', async () => {
    const { detect_consistency } = await import('../../src/graph/nodes/validation.js')

    const state = buildBaseState()
    state.currentChapterIndex = 1
    state.chapters = [
      {
        id: 'chapter-1',
        storyId: 'story-1',
        number: 1,
        title: null,
        outline: null,
        summary: '第一章摘要',
        foreshadows: null,
        status: 'done',
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'chapter-2',
        storyId: 'story-1',
        number: 2,
        title: null,
        outline: null,
        summary: null,
        foreshadows: null,
        status: 'drafting',
        createdAt: 0,
        updatedAt: 0,
      },
      null,
    ]
    readChapterContentMock.mockImplementation(async (_outputDir: string, chapterNumber: number) => {
      if (chapterNumber === 1) {
        return [
          '# 第一章',
          '',
          '前文。',
          '',
          '他把青铜钥匙交给阿洛，低声说：“天亮前守住北门。”',
        ].join('\n')
      }
      return '# 第二章\n\n阿洛握紧钥匙，守在北门外。'
    })

    await detect_consistency(createMockContext(), state)

    expect(capturedPreviousChapters).toContain('上一章结尾片段')
    expect(capturedPreviousChapters).toContain('他把青铜钥匙交给阿洛')
  })

  it('adds a continuity error when the current opening contradicts the previous ending', async () => {
    const { validate_chapter_comprehensive } = await import('../../src/graph/nodes/validation.js')

    const state = buildBaseState()
    state.currentChapterIndex = 1
    state.chapters = [
      {
        id: 'chapter-1',
        storyId: 'story-1',
        number: 1,
        title: null,
        outline: null,
        summary: '第一章摘要',
        foreshadows: null,
        status: 'done',
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'chapter-2',
        storyId: 'story-1',
        number: 2,
        title: null,
        outline: null,
        summary: null,
        foreshadows: null,
        status: 'drafting',
        createdAt: 0,
        updatedAt: 0,
      },
      null,
    ]
    readChapterContentMock.mockImplementation(async (_outputDir: string, chapterNumber: number) => {
      if (chapterNumber === 1) {
        return '# 第一章\n\n他把青铜钥匙交给阿洛，低声说：“天亮前守住北门。”'
      }
      return '# 第二章\n\n与此同时，青铜钥匙仍在主角怀中，他独自穿过南门。'
    })
    continuityCheckResponse = {
      isContinuous: false,
      severity: 'error',
      reason: '上一章结尾明确交出青铜钥匙，当前章开头又写青铜钥匙仍在主角怀中。',
      suggestion: '让当前章从阿洛持有钥匙并守住北门的状态承接。',
    }

    const result = await validate_chapter_comprehensive(createMockContext(), state)

    expect(result.pendingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'continuity',
          severity: 'error',
          source: 'consistency',
        }),
      ])
    )
    expect(capturedIssues).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'continuity' })])
    )
  })

  it('removes a consistency error once it is no longer reported in the next round', async () => {
    const { validate_chapter_comprehensive } = await import('../../src/graph/nodes/validation.js')

    const structuredIssue = {
      id: 'structured-1',
      type: 'event_missing',
      severity: 'error',
      description: '结构化事件未验证',
      source: 'outline_compliance',
    }
    const staleWordCountIssue = {
      id: 'wc-old',
      type: 'word_count',
      severity: 'warning',
      description: '上一轮遗留的字数警告',
      source: 'word_count',
    }

    const state = buildBaseState()
    state.pendingIssues = [structuredIssue, staleWordCountIssue]
    readChapterContentMock.mockResolvedValue('这是足够长的正文内容。'.repeat(500))
    consistencyOutput = {
      success: true,
      data: {
        is_consistent: false,
        issues: [
          {
            id: 'consistency-round-1',
            type: 'consistency',
            severity: 'error',
            description: '第一轮报告的一致性问题',
          },
        ],
      },
    }

    const round1 = await validate_chapter_comprehensive(createMockContext(), state)

    // 重跑检测器来源的旧 issue 被移除，结构化来源的 issue 保留，本轮新 error 并入
    expect(round1.pendingIssues).toHaveLength(2)
    expect(round1.pendingIssues?.some((i) => i.id === 'wc-old')).toBe(false)
    expect(round1.pendingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'structured-1' }),
        expect.objectContaining({
          id: 'consistency-round-1',
          severity: 'error',
          source: 'consistency',
        }),
      ])
    )

    // 第二轮：一致性问题已修复，检测器不再报告
    consistencyOutput = { success: true, data: { is_consistent: true, issues: [] } }
    const round2 = await validate_chapter_comprehensive(createMockContext(), {
      ...state,
      pendingIssues: round1.pendingIssues ?? [],
    })

    // 已修复的 consistency error 必须消失；结构化来源的 issue 不回归、不丢失
    expect(round2.pendingIssues).toEqual([expect.objectContaining({ id: 'structured-1' })])
  })

  it('passes character aliases to the chapter opening continuity check', async () => {
    const { detect_continuity } = await import('../../src/graph/nodes/validation.js')

    const state = buildBaseState()
    state.characters = [
      {
        id: 'character-1',
        storyId: 'story-1',
        name: '沈砚秋',
        description: '沈砚秋隐姓埋名寄养于江南姑苏舅家，改名徐砚秋，以落魄书生身份重回京城。',
        dialogueStyle: null,
        createdAt: 0,
      },
    ]
    state.currentChapterIndex = 1
    state.chapters = [
      {
        id: 'chapter-1',
        storyId: 'story-1',
        number: 1,
        title: null,
        outline: null,
        summary: '第一章摘要',
        foreshadows: null,
        status: 'done',
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'chapter-2',
        storyId: 'story-1',
        number: 2,
        title: null,
        outline: null,
        summary: null,
        foreshadows: null,
        status: 'drafting',
        createdAt: 0,
        updatedAt: 0,
      },
      null,
    ]
    readChapterContentMock.mockImplementation(async (_outputDir: string, chapterNumber: number) => {
      if (chapterNumber === 1) {
        return '# 第一章\n\n沈砚秋和衣躺下闭眼，听窗外更声远。'
      }
      return '# 第二章\n\n沈砚秋闭着眼不去看窗纸，窗纸那边的事不是徐砚秋该管的。'
    })

    await detect_continuity(createMockContext(), state)

    expect(capturedContinuityPrompt).toContain('人物设定')
    expect(capturedContinuityPrompt).toContain('改名徐砚秋')
  })

  describe('opening continuity judge skip', () => {
    function buildChapterTwoState() {
      const state = buildBaseState()
      state.currentChapterIndex = 1
      state.chapters = [
        {
          id: 'chapter-1',
          storyId: 'story-1',
          number: 1,
          title: null,
          outline: null,
          summary: '第一章摘要',
          foreshadows: null,
          status: 'done',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 'chapter-2',
          storyId: 'story-1',
          number: 2,
          title: null,
          outline: null,
          summary: null,
          foreshadows: null,
          status: 'drafting',
          createdAt: 0,
          updatedAt: 0,
        },
        null,
      ]
      readChapterContentMock.mockImplementation(
        async (_outputDir: string, chapterNumber: number) =>
          chapterNumber === 1 ? '# 第一章\n\n甲在前厅坐下。' : '# 第二章\n\n三日后，甲到了后屋。'
      )
      continuityCheckResponse = { isContinuous: false, reason: '位置断裂' }
      return state
    }

    it('skips the LLM judge when a validated chapterTimeAnchor exists', async () => {
      const { detect_continuity } = await import('../../src/graph/nodes/validation.js')
      const { createEmptyStoryMemory } = await import('../../src/story-memory/projector.js')

      const state = buildChapterTwoState()
      state.storyMemory = createEmptyStoryMemory()
      state.chapterPlan = { chapterTimeAnchor: '三日后清晨' } as typeof state.chapterPlan

      const result = await detect_continuity(createMockContext(), state)

      expect(result.pendingIssues).toBeUndefined()
      expect(capturedContinuityPrompt).toBe('')
    })

    it('skips the LLM judge when draft events already explain the location jump', async () => {
      const { detect_continuity } = await import('../../src/graph/nodes/validation.js')
      const { createEmptyStoryMemory } = await import('../../src/story-memory/projector.js')

      const state = buildChapterTwoState()
      const memory = createEmptyStoryMemory()
      memory.entities.characters['c-1'] = {
        id: 'c-1',
        name: '甲',
        locationId: 'loc-a',
        status: {},
        introducedIn: 0,
      }
      memory.entities.locations['loc-a'] = { id: 'loc-a', name: '前厅', introducedIn: 0 }
      memory.entities.locations['loc-b'] = { id: 'loc-b', name: '后屋', introducedIn: 0 }
      state.storyMemory = memory
      state.chapterPlan = null
      state.draftChapterEvents = [
        {
          id: 'e-1',
          type: 'character-location',
          characterId: 'c-1',
          locationId: 'loc-b',
          chapterIndex: 1,
          source: 'chapter',
        },
      ]

      const result = await detect_continuity(createMockContext(), state)

      expect(result.pendingIssues).toBeUndefined()
      expect(capturedContinuityPrompt).toBe('')
    })

    it('runs the LLM judge when there is no anchor and no explaining event', async () => {
      const { detect_continuity } = await import('../../src/graph/nodes/validation.js')
      const { createEmptyStoryMemory } = await import('../../src/story-memory/projector.js')

      const state = buildChapterTwoState()
      state.storyMemory = createEmptyStoryMemory()
      state.chapterPlan = null

      const result = await detect_continuity(createMockContext(), state)

      expect(capturedContinuityPrompt).not.toBe('')
      expect(result.pendingIssues).toHaveLength(1)
      expect(result.pendingIssues?.[0]?.type).toBe('continuity')
    })

    it('runs the LLM judge when storyMemory is missing even with an anchor', async () => {
      const { detect_continuity } = await import('../../src/graph/nodes/validation.js')

      const state = buildChapterTwoState()
      state.chapterPlan = { chapterTimeAnchor: '三日后清晨' } as typeof state.chapterPlan

      const result = await detect_continuity(createMockContext(), state)

      expect(capturedContinuityPrompt).not.toBe('')
      expect(result.pendingIssues).toHaveLength(1)
    })
  })
})
