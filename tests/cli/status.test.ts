import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ReducedGraphState } from '../../src/graph/state.ts'
import { applyEvents, createEmptyStoryMemory } from '../../src/story-memory/projector.ts'
import { projectForeshadowStack } from '../../src/story-memory/foreshadow-policy.ts'
import type { Story } from '../../src/types/story.ts'
import type { StoryMemory } from '../../src/types/story-memory.ts'

const getStoryMock = vi.fn<() => Story | null>()
const getStateMock = vi.fn<() => Promise<ReducedGraphState | null>>()
const tempDir = join(tmpdir(), `museflow-status-${randomUUID().slice(0, 8)}`)

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
    outputDir: tempDir,
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
        {
          index: 1,
          startChapter: 1,
          endChapter: totalChapters,
          title: '测试幕',
          theme: '测试主题',
          function: '测试功能',
          mandatoryBeats: ['主角出发'],
        },
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

function createAliasedForeshadowMemory(): StoryMemory {
  return applyEvents(createEmptyStoryMemory(), [
    {
      id: 'intro-active-early',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-active-early',
      text: 'active canonical fixture',
      expectedFulfillChapter: null,
      resolutionPolicy: 'should_resolve',
      chapterIndex: 0,
      source: 'outline',
    },
    {
      id: 'intro-active-late',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-active-late',
      text: 'active alias fixture',
      expectedFulfillChapter: null,
      resolutionPolicy: 'should_resolve',
      chapterIndex: 1,
      source: 'outline',
    },
    {
      id: 'merge-active',
      type: 'foreshadow-merge',
      canonicalForeshadowId: 'fs-active-early',
      duplicateForeshadowId: 'fs-active-late',
      reason: 'same active neutral fixture',
      chapterIndex: 1,
      source: 'outline',
    },
    {
      id: 'intro-fulfilled-early',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-fulfilled-early',
      text: 'fulfilled canonical fixture',
      expectedFulfillChapter: 3,
      resolutionPolicy: 'must_resolve',
      chapterIndex: 0,
      source: 'outline',
    },
    {
      id: 'intro-fulfilled-late',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-fulfilled-late',
      text: 'fulfilled alias fixture',
      expectedFulfillChapter: 3,
      resolutionPolicy: 'must_resolve',
      chapterIndex: 1,
      source: 'outline',
    },
    {
      id: 'fulfill-late',
      type: 'foreshadow-fulfill',
      foreshadowId: 'fs-fulfilled-late',
      chapterIndex: 2,
      source: 'chapter',
    },
    {
      id: 'merge-fulfilled',
      type: 'foreshadow-merge',
      canonicalForeshadowId: 'fs-fulfilled-early',
      duplicateForeshadowId: 'fs-fulfilled-late',
      reason: 'same fulfilled neutral fixture',
      chapterIndex: 2,
      source: 'outline',
    },
  ])
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

  it('shows required foreshadow pressure for the current act boundary', async () => {
    const state = createState(1, 3)
    state.storyMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        'fs-status': {
          id: 'fs-status',
          text: 'status fixture',
          kind: null,
          introducedIn: 0,
          expectedFulfillChapter: 3,
          fulfilledIn: null,
          resolutionPolicy: 'must_resolve',
          required: true,
          beatId: null,
        },
      },
    }
    getStateMock.mockResolvedValue(state)
    const { status } = await import('../../src/cli/commands/status.ts')

    await status({ storyId: 'story-1' })

    expect(logSpy).toHaveBeenCalledWith('伏笔边界压力: 1 个 must_resolve 硬义务待回收')
    expect(logSpy).toHaveBeenCalledWith('必须回收伏笔:')
    expect(logSpy).toHaveBeenCalledWith(
      '  1. [fs-status] "status fixture"（引入第 1 章，预计第 3 章回收）'
    )
  })

  it('shows soft policy counts without deadline alerts', async () => {
    const state = createState(1, 3)
    state.storyMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        'fs-soft': {
          id: 'fs-soft',
          text: 'soft fixture',
          kind: null,
          introducedIn: 0,
          expectedFulfillChapter: null,
          fulfilledIn: null,
          resolutionPolicy: 'should_resolve',
          required: true,
          beatId: null,
        },
        'fs-open': {
          id: 'fs-open',
          text: 'open fixture',
          kind: null,
          introducedIn: 0,
          expectedFulfillChapter: null,
          fulfilledIn: null,
          resolutionPolicy: 'may_remain_open',
          required: false,
          beatId: null,
        },
      },
    }
    state.foreshadowStack = projectForeshadowStack(state.storyMemory)
    getStateMock.mockResolvedValue(state)
    const { status } = await import('../../src/cli/commands/status.ts')

    await status({ storyId: 'story-1' })

    const output = logSpy.mock.calls.map(([value]) => String(value)).join('\n')
    expect(output).toContain('必须回收: 0')
    expect(output).toContain('建议自然回收: 1')
    expect(output).toContain('可保持开放: 1')
    expect(output).not.toContain('⏳ 正常')
  })

  it('reports active and fulfilled canonical obligations once without listing alias records', async () => {
    const state = createState(2, 3)
    state.storyMemory = createAliasedForeshadowMemory()
    state.foreshadowStack = projectForeshadowStack(state.storyMemory)
    getStateMock.mockResolvedValue(state)
    const { status } = await import('../../src/cli/commands/status.ts')

    await status({ storyId: 'story-1' })

    const output = logSpy.mock.calls.map(([value]) => String(value)).join('\n')
    expect(output).toContain('伏笔: 1 个已回收, 1 个未结')
    expect(output).toContain('fulfilled canonical fixture')
    expect(output).not.toContain('active alias fixture')
    expect(output).not.toContain('fulfilled alias fixture')
  })

  it('shows high risk when overdue key beats exist', async () => {
    const state = createState(2, 4)
    state.storyArc = {
      totalChapters: 4,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 2,
          title: '第一幕',
          theme: '出发',
          function: '建立',
          mandatoryBeats: ['主角出发'],
        },
        {
          index: 2,
          startChapter: 3,
          endChapter: 4,
          title: '第二幕',
          theme: '揭秘',
          function: '冲突',
          mandatoryBeats: ['核心秘密揭晓'],
        },
      ],
      keyBeats: [{ id: 'A1-B1', beat: '核心秘密揭晓', deadlineAct: 1, required: true }],
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
