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
      capturedContinuityPrompt = messages.map(m => m.content ?? '').join('\n')
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
let consistencyOutput = { success: true, data: { is_consistent: true, issues: [] } }
let continuityCheckResponse: unknown = { isContinuous: true }

const { readChapterContentMock } = vi.hoisted(() => ({
  readChapterContentMock: vi.fn(),
}))

vi.mock('../../src/agents/index.js', () => ({
  WorldbuilderAgent: class {},
  CharacterAgent: class {},
  OutlineAgent: class {},
  ChapterAgent: class {},
  ChapterPlannerAgent: class {},
  ForeshadowingAgent: class {
    async run() {
      return { success: true, data: { new_foreshadows: [], fulfilled_foreshadows: [], overdue_foreshadows: [] } }
    }

    processOutput(_output: unknown, _chapterIndex: number, existingStack: unknown[]) {
      return existingStack
    }
  },
  ConsistencyAgent: class {
    async run(state: { storyState?: string; outline?: string; timelineSnapshot?: string; previousChapters?: string; issues?: unknown[] }) {
      capturedStoryState = state.storyState ?? ''
      capturedOutline = state.outline ?? ''
      capturedTimelineSnapshot = state.timelineSnapshot ?? ''
      capturedPreviousChapters = state.previousChapters ?? ''
      capturedIssues = state.issues ?? []
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
      chapters: [{ id: 'chapter-1', storyId: 'story-1', number: 1, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 }, null, null],
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
    consistencyOutput = { success: true, data: { is_consistent: true, issues: [] } }
    continuityCheckResponse = { isContinuous: true }
    vi.clearAllMocks()
    readChapterContentMock.mockResolvedValue('正文内容')
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

  it('filters superseded facts from timeline when canonical facts exist', async () => {
    const { detect_consistency } = await import('../../src/graph/nodes/validation.js')

    const state = buildBaseState()
    state.currentChapterIndex = 2
    state.chapters[2] = { id: 'chapter-3', storyId: 'story-1', number: 3, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 }
    state.chapterSummaries = [
      JSON.stringify({
        characters: [],
        characterFacts: [
          { character: '旁白', facts: [{ text: '木之灵物位于东方灵河旧址', importance: 'critical' }] },
        ],
        keyEvents: [],
        locations: [],
        keyItems: [],
        activePlots: [],
        mood: '',
      }),
      JSON.stringify({
        characters: [],
        characterFacts: [
          { character: '旁白', facts: [{ text: '木之灵物被转移到昆仑山', importance: 'critical' }] },
        ],
        keyEvents: [],
        locations: [],
        keyItems: [],
        activePlots: [],
        mood: '',
      }),
    ]
    state.storyState.canonicalFacts = [
      {
        id: 'cf1',
        subject: '木之灵物',
        attribute: '所在位置',
        value: '昆仑山',
        establishedIn: 1,
        supersedes: [{ chapter: 0, oldValue: '东方灵河旧址' }],
      },
    ]

    await detect_consistency(createMockContext(), state)
    expect(capturedStoryState).toContain('【权威事实】')
    // The superseded old location should not appear in the timeline snapshot
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
      chapters: [{ id: 'chapter-1', storyId: 'story-1', number: 1, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 }, null, null],
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
        { id: 'chapter-1', storyId: 'story-1', number: 1, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 },
        { id: 'chapter-2', storyId: 'story-1', number: 2, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 },
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
      { id: 'chapter-1', storyId: 'story-1', number: 1, title: null, outline: null, summary: '第一章摘要', foreshadows: null, status: 'done', createdAt: 0, updatedAt: 0 },
      { id: 'chapter-2', storyId: 'story-1', number: 2, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 },
      null,
    ]
    state.chapterSummaries = ['第一章摘要']
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
      { id: 'chapter-1', storyId: 'story-1', number: 1, title: null, outline: null, summary: '第一章摘要', foreshadows: null, status: 'done', createdAt: 0, updatedAt: 0 },
      { id: 'chapter-2', storyId: 'story-1', number: 2, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 },
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
      expect.arrayContaining([
        expect.objectContaining({ type: 'continuity' }),
      ])
    )
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
      { id: 'chapter-1', storyId: 'story-1', number: 1, title: null, outline: null, summary: '第一章摘要', foreshadows: null, status: 'done', createdAt: 0, updatedAt: 0 },
      { id: 'chapter-2', storyId: 'story-1', number: 2, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 },
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
})
