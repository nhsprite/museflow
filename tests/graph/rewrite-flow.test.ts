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
  ChapterAgent: class {
    async run() {
      return { content: mockChapterContentValue }
    }
  },
  QualityAgent: class {},
  ForeshadowingAgent: class {},
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
    expect(logs.some(log => String(log).includes('第 1/20 章处理完成'))).toBe(true)
    expect(logs.some(log => String(log).includes('第 2/20 章处理完成'))).toBe(false)
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
    } as never)).rejects.toThrow('第 1 章内容为空，AI 生成失败')
  })

  it('throws error when AI returns only whitespace', async () => {
    mockChapterContentValue = '   \n\t  '

    const { draft_chapter } = await import('../../src/graph/nodes.js')

    await expect(draft_chapter({
      ...baseState,
      currentChapterIndex: 0,
    } as never)).rejects.toThrow('第 1 章内容为空，AI 生成失败')
  })

  it('throws error when AI returns null content', async () => {
    mockChapterContentValue = null as unknown as string

    const { draft_chapter } = await import('../../src/graph/nodes.js')

    await expect(draft_chapter({
      ...baseState,
      currentChapterIndex: 0,
    } as never)).rejects.toThrow('第 1 章内容为空，AI 生成失败')
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
