import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelProvider } from '../../src/model/provider.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { RuntimeContext } from '../../src/core/context.js'

const saveChapterCheckpoint = vi.fn().mockResolvedValue(undefined)
const pruneIntermediateCheckpoints = vi.fn().mockResolvedValue(undefined)
const writeChapterContent = vi.fn().mockResolvedValue(undefined)
const writeStagedChapterContent = vi.fn().mockResolvedValue(undefined)
const readChapterContent = vi.fn().mockResolvedValue('old chapter content')
const readChapterContentForRun = vi.fn().mockResolvedValue('old chapter content')
let mockChapterContentValue =
  'rewritten chapter content ' + '主角走在路上，心中思绪万千。'.repeat(600)

const mockChat = vi.fn(async (): Promise<string> => JSON.stringify({ results: [true] }))
const mockChatStructured = vi.fn().mockResolvedValue({ results: [true] })
const foreshadowProcessOutput = vi.fn(
  (_output: never, _chapterIndex: number, existingStack: never[]) => existingStack
)

function createMockProvider(): ModelProvider {
  return {
    chat: mockChat,
    chatStructured: mockChatStructured,
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

vi.mock('../../src/agents/index.js', () => ({
  WorldbuilderAgent: class {},
  CharacterAgent: class {},
  OutlineAgent: class {},
  HighLevelOutlineAgent: class {},
  ChapterAgent: class {
    async run() {
      return { content: mockChapterContentValue }
    }
  },
  ChapterPlannerAgent: class {
    async run() {
      return {
        success: true,
        data: {
          sections: [
            {
              title: 'Section 1',
              summary: 'summary',
              wordCount: 100,
              events: ['event'],
              characters: ['character'],
              timeMark: 'now',
            },
          ],
          timeline: [],
          outlineCheck: [],
        },
      }
    }
  },
  ForeshadowingAgent: class {
    async run() {
      return {
        success: true,
        data: {
          new_foreshadows: [],
          fulfilled_foreshadows: [],
          overdue_foreshadows: [],
        },
      }
    }
    processOutput(_output: never, _chapterIndex: number, existingStack: never[]) {
      return foreshadowProcessOutput(_output, _chapterIndex, existingStack)
    }
  },
  ConsistencyAgent: class {
    async run() {
      return { success: true, data: [] }
    }
    async processOutput() {
      return []
    }
  },
  SummaryAgent: class {
    async run() {
      return { success: false, error: 'summary failed' }
    }
  },
  processSummaryOutput: vi.fn(),
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  writeChapterContent,
  writeStagedChapterContent,
  readChapterContent,
  readChapterContentForRun,
  writeOutlineContent: vi.fn(),
  writeStoryBible: vi.fn(),
}))

vi.mock('../../src/storage/meta/stores/chapter.js', () => ({ saveOutline: vi.fn() }))
vi.mock('../../src/storage/meta/stores/character.js', () => ({ saveCharacters: vi.fn() }))
vi.mock('../../src/storage/meta/stores/world.js', () => ({ saveWorld: vi.fn() }))
const saveStoryState = vi.fn()
const getStoryState = vi.fn().mockReturnValue(null)

vi.mock('../../src/storage/meta/stores/story-state.js', () => ({
  saveStoryState,
  getStoryState,
  createEmptyStoryState: () => ({
    characterLocations: {},
    characterStatus: {},
    keyItemsLocation: {},
    keyItemsState: {},
    activePlots: [],
    revealedSecrets: [],
    pendingTasks: [],
    currentScene: '',
    storyTime: '',
  }),
}))

vi.mock('../../src/storage/meta/stores/story.js', () => ({
  updateStoryTitle: vi.fn(),
  renameStoryOutputDir: vi.fn(),
}))
vi.mock('../../src/genres/registry.js', () => ({ getGenreSkill: vi.fn().mockReturnValue(null) }))

vi.mock('../../src/utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/paths.js')>()
  return {
    ...actual,
    getStoryOutputDirWithTitle: vi.fn(),
  }
})

vi.mock('../../src/utils/id.js', () => ({ generateId: vi.fn().mockReturnValue('generated-id') }))
vi.mock('../../src/graph/checkpointer.js', () => ({
  getCheckpointer: () => ({
    saveChapterCheckpoint,
    pruneIntermediateCheckpoints,
    clearPendingWrites: vi.fn().mockResolvedValue(undefined),
    getTuple: vi.fn().mockResolvedValue(null),
  }),
}))

let tempDir: string
let baseState: ReducedGraphState

beforeEach(() => {
  vi.clearAllMocks()
  foreshadowProcessOutput.mockImplementation(
    (_output: never, _chapterIndex: number, existingStack: never[]) => existingStack
  )
  tempDir = mkdtempSync(join(tmpdir(), 'museflow-rewrite-'))
  baseState = {
    story: { id: 'story-1', title: 'Story', outputDir: tempDir },
    idea: 'idea',
    genre: 'default',
    totalChapters: 20,
    world: null,
    characters: [],
    outline: [{ number: 1, title: 'Chapter 1', description: 'Desc 1' }],
    chapters: [null],
    currentChapterIndex: 0,
    foreshadowStack: [],
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: true,
    lastPrintedChapter: 0,
    lastTimelineSnapshot: null,
  }
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('rewrite flow regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readChapterContent.mockResolvedValue('old chapter content')
    readChapterContentForRun.mockResolvedValue('old chapter content')
  })

  it('rewrites the current chapter using existing chapter content', async () => {
    const { draft_chapter } = await import('../../src/graph/nodes/draft.js')

    const draftResult = await draft_chapter(createMockContext(), {
      ...baseState,
      currentChapterIndex: 0,
      rewriteApproved: true,
    } as never)

    expect(draftResult.rewriteApproved).toBeUndefined()
    expect(draftResult.pendingIssues).toBeUndefined()
    expect(readChapterContent).toHaveBeenCalledWith(tempDir, 1)
    expect(writeStagedChapterContent).toHaveBeenCalledWith(
      tempDir,
      1,
      `# 第1章 Chapter 1\n\n${mockChapterContentValue}`
    )
    expect(draftResult.chapters?.[0]?.status).toBe('drafting')
  })

  it('logs the completed chapter number instead of the next chapter number', async () => {
    const { finalize_chapter } = await import('../../src/graph/nodes/finalization.js')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const result = await finalize_chapter(createMockContext(), {
      ...baseState,
      currentChapterIndex: 0,
      chapters: [
        {
          id: 'chapter-1',
          storyId: 'story-1',
          number: 1,
          title: 'Chapter 1',
          outline: 'Desc 1',
          summary: 'Summary 1',
          foreshadows: null,
          status: 'done',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    } as never)

    const logs = logSpy.mock.calls.map((call) => call[0])
    expect(result.rewriteApproved).toBeUndefined()
    expect(result.rewriteRequested).toBeUndefined()
    expect(result.currentChapterIndex).toBe(1)
  })
})

describe('draft_chapter guard against empty content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChapterContentValue = 'rewritten chapter content'
  })

  it('throws error when AI returns empty string', async () => {
    mockChapterContentValue = ''

    const { draft_chapter } = await import('../../src/graph/nodes/draft.js')

    await expect(
      draft_chapter(createMockContext(), {
        ...baseState,
        currentChapterIndex: 0,
      } as never)
    ).rejects.toThrow('第 1 章内容为空，AI 未返回有效内容')
  })

  it('throws error when AI returns only whitespace', async () => {
    mockChapterContentValue = '   \n\t  '

    const { draft_chapter } = await import('../../src/graph/nodes/draft.js')

    await expect(
      draft_chapter(createMockContext(), {
        ...baseState,
        currentChapterIndex: 0,
      } as never)
    ).rejects.toThrow('第 1 章内容为空，AI 未返回有效内容')
  })

  it('throws error when AI returns null content', async () => {
    mockChapterContentValue = null as unknown as string

    const { draft_chapter } = await import('../../src/graph/nodes/draft.js')

    await expect(
      draft_chapter(createMockContext(), {
        ...baseState,
        currentChapterIndex: 0,
      } as never)
    ).rejects.toThrow('第 1 章内容为空，AI 未返回有效内容')
  })
})

describe('finalize_chapter guard against empty file', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws error when chapter file does not exist (returns null)', async () => {
    readChapterContentForRun.mockResolvedValue(null)

    const { finalize_chapter } = await import('../../src/graph/nodes/finalization.js')

    await expect(
      finalize_chapter(createMockContext(), {
        ...baseState,
        currentChapterIndex: 0,
      } as never)
    ).rejects.toThrow('第 1 章文件为空或不存在，无法标记为完成')
  })

  it('throws error when chapter file is empty string', async () => {
    readChapterContentForRun.mockResolvedValue('')

    const { finalize_chapter } = await import('../../src/graph/nodes/finalization.js')

    await expect(
      finalize_chapter(createMockContext(), {
        ...baseState,
        currentChapterIndex: 0,
      } as never)
    ).rejects.toThrow('第 1 章文件为空或不存在，无法标记为完成')
  })

  it('throws error when chapter file is only whitespace', async () => {
    readChapterContentForRun.mockResolvedValue('   \n\t  ')

    const { finalize_chapter } = await import('../../src/graph/nodes/finalization.js')

    await expect(
      finalize_chapter(createMockContext(), {
        ...baseState,
        currentChapterIndex: 0,
      } as never)
    ).rejects.toThrow('第 1 章文件为空或不存在，无法标记为完成')
  })
})

describe('finalize_chapter summary failure guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readChapterContentForRun.mockResolvedValue('chapter content')
  })

  it('does not advance the chapter when summary extraction fails', async () => {
    const { finalize_chapter } = await import('../../src/graph/nodes/finalization.js')

    const result = await finalize_chapter(createMockContext(), {
      ...baseState,
      currentChapterIndex: 0,
      chapters: [
        {
          id: 'chapter-1',
          storyId: 'story-1',
          number: 1,
          title: 'Chapter 1',
          outline: 'Desc 1',
          summary: null,
          foreshadows: null,
          status: 'drafting',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    } as never)

    expect(result.currentChapterIndex).toBeUndefined()
    expect(result.pendingIssues?.[0]).toMatchObject({
      severity: 'error',
      type: 'state_corruption',
    })
    expect(result.pendingIssues?.[0]?.description).toContain('摘要')
  })
})

describe('finalize_chapter ages pending tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readChapterContentForRun.mockResolvedValue('chapter content')
    getStoryState.mockReturnValue(null)
  })

  it('marks pending tasks due at or before current chapter as expired', async () => {
    const { finalize_chapter } = await import('../../src/graph/nodes/finalization.js')

    const result = await finalize_chapter(createMockContext(), {
      ...baseState,
      currentChapterIndex: 1,
      chapters: [
        {
          id: 'chapter-2',
          storyId: 'story-1',
          number: 2,
          title: 'Chapter 2',
          outline: 'Desc 2',
          summary: 'Summary 2',
          foreshadows: null,
          status: 'done',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      storyState: {
        characterLocations: {},
        characterStatus: {},
        keyItemsLocation: {},
        keyItemsState: {},
        activePlots: [],
        revealedSecrets: [],
        pendingTasks: [
          {
            id: 't1',
            assignee: '主角',
            description: '明日午时前出发',
            createdChapter: 1,
            dueChapter: 2,
            status: 'pending',
          },
          {
            id: 't2',
            assignee: '主角',
            description: '后日赴约',
            createdChapter: 1,
            dueChapter: 3,
            status: 'pending',
          },
          {
            id: 't3',
            assignee: '主角',
            description: '已完成之事',
            createdChapter: 1,
            dueChapter: 2,
            status: 'done',
          },
        ],
        currentScene: '',
        storyTime: '',
      },
    } as never)

    const updatedTasks = result.storyState!.pendingTasks as Array<{ id: string; status: string }>
    expect(updatedTasks.find((t) => t.id === 't1')!.status).toBe('expired')
    expect(updatedTasks.find((t) => t.id === 't2')!.status).toBe('pending')
    expect(updatedTasks.find((t) => t.id === 't3')!.status).toBe('done')
  })
})

describe('detect_foreshadowing preserves current-chapter foreshadows', () => {
  beforeEach(() => {
    readChapterContentForRun.mockResolvedValue('old chapter content')
  })

  it('keeps a foreshadow created in the current chapter for future fulfillment', async () => {
    const { detect_foreshadowing } = await import('../../src/graph/nodes/validation.js')

    const currentChapterForeshadow = {
      id: 'fs-current',
      text: '主角在旧货市场偶然买下的青铜戒指，表面刻着一行无人能识的古老铭文，将在未来揭示出一段尘封千年的宿命纠葛',
      expectedFulfillChapter: 3,
      createdAtChapter: 1,
      createdAt: Date.now(),
      status: 'planted' as const,
      isExplicit: false,
    }

    const result = await detect_foreshadowing(createMockContext(), {
      ...baseState,
      currentChapterIndex: 0,
      foreshadowStack: [currentChapterForeshadow],
      chapters: [
        {
          id: 'chapter-1',
          storyId: 'story-1',
          number: 1,
          title: 'Chapter 1',
          outline: 'Desc 1',
          summary: null,
          foreshadows: null,
          status: 'drafting',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    } as never)

    expect(result.foreshadowStack).toHaveLength(1)
    expect(result.foreshadowStack?.[0]?.text).toBe(currentChapterForeshadow.text)
  })
})

describe('validate_chapter_comprehensive foreshadow authority', () => {
  beforeEach(() => {
    readChapterContentForRun.mockResolvedValue('字'.repeat(3000))
  })

  it('does not persist semantic foreshadow candidates when StoryMemory is present', async () => {
    const { validate_chapter_comprehensive } = await import('../../src/graph/nodes/validation.js')
    foreshadowProcessOutput.mockReturnValueOnce([
      {
        id: 'semantic-only',
        text: '语义检测提出但未进入结构化事件账本的候选伏笔',
        expectedFulfillChapter: 3,
        createdAtChapter: 1,
        createdAt: 1,
        status: 'planted',
        isExplicit: false,
        required: true,
      },
    ])

    const result = await validate_chapter_comprehensive(createMockContext(), {
      ...baseState,
      chapters: [
        {
          id: 'chapter-1',
          storyId: 'story-1',
          number: 1,
          title: 'Chapter 1',
          outline: 'Desc 1',
          summary: null,
          foreshadows: null,
          status: 'drafting',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
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
        canonicalFacts: [],
      },
      storyMemory: {
        version: '1',
        lastChapterIndex: 0,
        entities: { characters: {}, items: {}, locations: {}, factions: {}, plots: {} },
        events: [],
        foreshadows: {},
        beats: {},
        tasks: {},
      },
    } as never)

    expect(result.foreshadowStack).toBeUndefined()
  })
})
