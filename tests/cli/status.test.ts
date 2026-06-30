import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReducedGraphState } from '../../src/graph/state.ts'
import type { Story } from '../../src/types/story.ts'

const getStoryMock = vi.fn<() => Story | null>()
const getStateMock = vi.fn<() => Promise<ReducedGraphState | null>>()

vi.mock('../../src/storage/meta/stores/story.ts', () => ({
  getStory: getStoryMock,
  initStoryDb: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/core/runner.ts', () => ({
  getState: getStateMock,
}))

function createStory(): Story {
  return {
    id: 'story-1',
    idea: '一个少年踏上修仙路',
    title: '',
    genre: 'xianxia',
    totalChapters: 3,
    status: 'writing',
    provider: 'openai',
    outputDir: '/tmp/story-1',
    createdAt: 0,
    updatedAt: 0,
  }
}

function createState(currentChapterIndex: number, totalChapters: number): ReducedGraphState {
  const chapters = new Array(totalChapters).fill(null)
  for (let i = 0; i < currentChapterIndex && i < totalChapters; i++) {
    chapters[i] = {
      id: `chapter-${i + 1}`,
      storyId: 'story-1',
      number: i + 1,
      title: `Chapter ${i + 1}`,
      outline: '',
      summary: '',
      foreshadows: null,
      status: 'done',
      createdAt: 1,
      updatedAt: 1,
    }
  }
  return {
    story: createStory(),
    idea: '一个少年踏上修仙路',
    genre: 'xianxia',
    totalChapters,
    world: null,
    characters: [],
    outline: [],
    storyArc: {
      totalChapters,
      acts: [
        { index: 1, startChapter: 1, endChapter: totalChapters, title: '测试幕', theme: '测试主题', function: '测试功能', mandatoryBeats: ['主角出发'] },
      ],
      keyBeats: [],
    },
    actProgress: { 1: { consumed: [], pending: ['主角出发'] } },
    chapters,
    currentChapterIndex,
    foreshadowStack: [],
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
  }
}

describe('status command chapter display', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getStoryMock.mockReturnValue(createStory())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the current chapter as 1-based while drafting', async () => {
    getStateMock.mockResolvedValue(createState(0, 3))
    const { status } = await import('../../src/cli/commands/status.ts')

    await status({ storyId: 'story-1' })

    expect(logSpy).toHaveBeenCalledWith('章节进度: 0/3 (0%)')
    expect(logSpy).toHaveBeenCalledWith('下一步: 撰写第 1 章')
  })

  it('clamps the display chapter when the story is complete', async () => {
    getStateMock.mockResolvedValue(createState(3, 3))
    const { status } = await import('../../src/cli/commands/status.ts')

    await status({ storyId: 'story-1' })

    expect(logSpy).toHaveBeenCalledWith('章节进度: 3/3 (100%)')
    expect(logSpy).toHaveBeenCalledWith('✓ 故事已完成')
  })

  it('shows arc progress in status output', async () => {
    getStateMock.mockResolvedValue(createState(1, 3))
    const { status } = await import('../../src/cli/commands/status.ts')

    await status({ storyId: 'story-1' })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('故事弧线'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('测试幕'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('节拍进度'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('收尾风险'))
  })

  it('shows high risk when overdue key beats exist', async () => {
    const state = createState(2, 4)
    state.storyArc = {
      totalChapters: 4,
      acts: [
        { index: 1, startChapter: 1, endChapter: 2, title: '第一幕', theme: '出发', function: '建立', mandatoryBeats: ['主角出发'] },
        { index: 2, startChapter: 3, endChapter: 4, title: '第二幕', theme: '揭秘', function: '冲突', mandatoryBeats: ['核心秘密揭晓'] },
      ],
      keyBeats: [{ beat: '核心秘密揭晓', deadlineAct: 1 }],
    }
    state.actProgress = {
      1: { consumed: ['主角出发'], pending: [] },
      2: { consumed: [], pending: ['核心秘密揭晓'] },
    }
    getStateMock.mockResolvedValue(state)
    const { status } = await import('../../src/cli/commands/status.ts')

    await status({ storyId: 'story-1' })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('逾期: 核心秘密揭晓'))
    expect(logSpy).toHaveBeenCalledWith('收尾风险: 高')
  })
})
