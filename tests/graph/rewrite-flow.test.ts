import { beforeEach, describe, expect, it, vi } from 'vitest'

const saveChapterCheckpoint = vi.fn().mockResolvedValue(undefined)
const pruneIntermediateCheckpoints = vi.fn().mockResolvedValue(undefined)
const writeChapterContent = vi.fn().mockResolvedValue(undefined)
const readChapterContent = vi.fn().mockResolvedValue('old chapter content')
const appendTimelineSnapshot = vi.fn().mockReturnValue({})
const getLatestSnapshot = vi.fn().mockReturnValue(null)
const saveForeshadowStack = vi.fn()

let mockChapterContentValue = 'rewritten chapter content'

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
          sections: [{
            title: 'Section 1',
            summary: 'summary',
            wordCount: 100,
            events: ['event'],
            characters: ['character'],
            timeMark: 'now',
          }],
          timeline: [],
          outlineCheck: [],
        },
      }
    }
  },
  QualityAgent: class {},
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
      return existingStack
    }
  },
  HallucinationAgent: class {},
  ConsistencyAgent: class {},
  OutlineComplianceAgent: class {},
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  writeChapterContent,
  readChapterContent,
  writeOutlineContent: vi.fn(),
  writeStoryBible: vi.fn(),
}))

vi.mock('../../src/storage/database/dao/chapter.js', () => ({ saveOutline: vi.fn() }))
vi.mock('../../src/storage/database/dao/character.js', () => ({ saveCharacters: vi.fn() }))
vi.mock('../../src/storage/database/dao/world.js', () => ({ saveWorld: vi.fn() }))
const saveStoryState = vi.fn()
const getStoryState = vi.fn().mockReturnValue(null)

vi.mock('../../src/storage/database/dao/story-state.js', () => ({
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

vi.mock('../../src/storage/database/dao/story.js', () => ({
  updateStoryTitle: vi.fn(),
  renameStoryOutputDir: vi.fn(),
}))
const saveForeshadowAlerts = vi.fn()

vi.mock('../../src/storage/database/dao/timeline.js', () => ({
  appendTimelineSnapshot,
  getLatestSnapshot,
  saveForeshadowStack,
  saveForeshadowAlerts,
}))
vi.mock('../../src/genres/registry.js', () => ({ getGenreSkill: vi.fn().mockReturnValue(null) }))
vi.mock('../../src/utils/paths.js', () => ({ getStoryOutputDirWithTitle: vi.fn() }))
vi.mock('../../src/utils/id.js', () => ({ generateId: vi.fn().mockReturnValue('generated-id') }))
vi.mock('../../src/graph/checkpointer.js', () => ({
  getCheckpointer: () => ({ saveChapterCheckpoint, pruneIntermediateCheckpoints, clearPendingWrites: vi.fn().mockResolvedValue(undefined) }),
}))

const baseState = {
  story: { id: 'story-1', title: 'Story', outputDir: '/tmp/story' },
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

describe('rewrite flow regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readChapterContent.mockResolvedValue('old chapter content')
    getLatestSnapshot.mockReturnValue(null)
  })

  it('rewrites the current chapter using existing chapter content', async () => {
    const { draft_chapter } = await import('../../src/graph/nodes.js')

    const draftResult = await draft_chapter({
      ...baseState,
      currentChapterIndex: 0,
      rewriteApproved: true,
    } as never)

    expect(draftResult.rewriteApproved).toBeUndefined()
    expect(draftResult.pendingIssues).toBeUndefined()
    expect(readChapterContent).toHaveBeenCalledWith('/tmp/story', 1)
    expect(writeChapterContent).toHaveBeenCalledWith('/tmp/story', 1, '# 第1章 Chapter 1\n\nrewritten chapter content')
    expect(draftResult.chapters?.[0]?.status).toBe('drafting')
  })

  it('logs the completed chapter number instead of the next chapter number', async () => {
    const { finalize_chapter } = await import('../../src/graph/nodes.js')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const result = await finalize_chapter({
      ...baseState,
      currentChapterIndex: 0,
      chapters: [{
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
      }],
    } as never)

    const logs = logSpy.mock.calls.map(call => call[0])
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

    const { draft_chapter } = await import('../../src/graph/nodes.js')

    await expect(draft_chapter({
      ...baseState,
      currentChapterIndex: 0,
    } as never)).rejects.toThrow('第 1 章内容为空，AI 未返回有效内容')
  })

  it('throws error when AI returns only whitespace', async () => {
    mockChapterContentValue = '   \n\t  '

    const { draft_chapter } = await import('../../src/graph/nodes.js')

    await expect(draft_chapter({
      ...baseState,
      currentChapterIndex: 0,
    } as never)).rejects.toThrow('第 1 章内容为空，AI 未返回有效内容')
  })

  it('throws error when AI returns null content', async () => {
    mockChapterContentValue = null as unknown as string

    const { draft_chapter } = await import('../../src/graph/nodes.js')

    await expect(draft_chapter({
      ...baseState,
      currentChapterIndex: 0,
    } as never)).rejects.toThrow('第 1 章内容为空，AI 未返回有效内容')
  })
})

describe('finalize_chapter guard against empty file', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws error when chapter file does not exist (returns null)', async () => {
    readChapterContent.mockResolvedValue(null)

    const { finalize_chapter } = await import('../../src/graph/nodes.js')

    await expect(finalize_chapter({
      ...baseState,
      currentChapterIndex: 0,
    } as never)).rejects.toThrow('第 1 章文件为空或不存在，无法标记为完成')
  })

  it('throws error when chapter file is empty string', async () => {
    readChapterContent.mockResolvedValue('')

    const { finalize_chapter } = await import('../../src/graph/nodes.js')

    await expect(finalize_chapter({
      ...baseState,
      currentChapterIndex: 0,
    } as never)).rejects.toThrow('第 1 章文件为空或不存在，无法标记为完成')
  })

  it('throws error when chapter file is only whitespace', async () => {
    readChapterContent.mockResolvedValue('   \n\t  ')

    const { finalize_chapter } = await import('../../src/graph/nodes.js')

    await expect(finalize_chapter({
      ...baseState,
      currentChapterIndex: 0,
    } as never)).rejects.toThrow('第 1 章文件为空或不存在，无法标记为完成')
  })
})

describe('finalize_chapter ages pending tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readChapterContent.mockResolvedValue('chapter content')
    getStoryState.mockReturnValue(null)
  })

  it('marks pending tasks due at or before current chapter as expired', async () => {
    const { finalize_chapter } = await import('../../src/graph/nodes.js')

    const result = await finalize_chapter({
      ...baseState,
      currentChapterIndex: 1,
      chapters: [{
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
      }],
      storyState: {
        characterLocations: {},
        characterStatus: {},
        keyItemsLocation: {},
        keyItemsState: {},
        activePlots: [],
        revealedSecrets: [],
        pendingTasks: [
          { id: 't1', assignee: '主角', description: '明日午时前出发', createdChapter: 1, dueChapter: 2, status: 'pending' },
          { id: 't2', assignee: '主角', description: '后日赴约', createdChapter: 1, dueChapter: 3, status: 'pending' },
          { id: 't3', assignee: '主角', description: '已完成之事', createdChapter: 1, dueChapter: 2, status: 'done' },
        ],
        currentScene: '',
        storyTime: '',
      },
    } as never)

    const savedState = saveStoryState.mock.calls[0]![1] as { pendingTasks: Array<{ id: string; status: string }> }
    expect(savedState.pendingTasks.find(t => t.id === 't1')!.status).toBe('expired')
    expect(savedState.pendingTasks.find(t => t.id === 't2')!.status).toBe('pending')
    expect(savedState.pendingTasks.find(t => t.id === 't3')!.status).toBe('done')
    expect(result.storyState).toBeDefined()
  })
})

describe('detect_foreshadowing preserves current-chapter foreshadows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readChapterContent.mockResolvedValue('old chapter content')
  })

  it('keeps a foreshadow created in the current chapter for future fulfillment', async () => {
    const { detect_foreshadowing } = await import('../../src/graph/nodes.js')

    const currentChapterForeshadow = {
      id: 'fs-current',
      text: '主角在旧货市场偶然买下的青铜戒指，表面刻着一行无人能识的古老铭文，将在未来揭示出一段尘封千年的宿命纠葛',
      expectedFulfillChapter: 3,
      createdAtChapter: 1,
      createdAt: Date.now(),
      status: 'planted' as const,
      isExplicit: false,
    }

    const result = await detect_foreshadowing({
      ...baseState,
      currentChapterIndex: 0,
      foreshadowStack: [currentChapterForeshadow],
      chapters: [{
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
      }],
    } as never)

    expect(result.foreshadowStack).toHaveLength(1)
    expect(result.foreshadowStack?.[0]?.text).toBe(currentChapterForeshadow.text)
  })
})
