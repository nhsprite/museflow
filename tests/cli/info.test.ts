import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReducedGraphState } from '../../src/graph/state.ts'
import type { Story } from '../../src/types/story.ts'

const getStoryMock = vi.fn<() => Story | null>()
const getStateMock = vi.fn<() => Promise<ReducedGraphState | null>>()
const getGenreSkillMock = vi.fn()
const loadConfigMock = vi.fn()

vi.mock('../../src/storage/database/dao/story.ts', () => ({
  getStory: getStoryMock,
}))

vi.mock('../../src/core/runner.ts', () => ({
  getState: getStateMock,
}))

vi.mock('../../src/genres/registry.ts', () => ({
  getGenreSkill: getGenreSkillMock,
}))

vi.mock('../../src/config/store.ts', () => ({
  loadConfig: loadConfigMock,
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
  return {
    story: createStory(),
    idea: '一个少年踏上修仙路',
    genre: 'xianxia',
    totalChapters,
    world: null,
    characters: [],
    outline: [],
    chapters: new Array(totalChapters).fill(null),
    currentChapterIndex,
    foreshadowStack: [],
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
  }
}

describe('info command chapter display', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getStoryMock.mockReturnValue(createStory())
    getGenreSkillMock.mockReturnValue(null)
    loadConfigMock.mockReturnValue({
      model: { provider: 'openai', model: 'gpt-4o' },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the first chapter as 1-based', async () => {
    getStateMock.mockResolvedValue(createState(0, 3))
    const { info } = await import('../../src/cli/commands/info.ts')

    await info({ storyId: 'story-1' })

    expect(logSpy).toHaveBeenCalledWith('  当前章节: 1/3')
  })

  it('clamps the display chapter when the story is complete', async () => {
    getStateMock.mockResolvedValue(createState(3, 3))
    const { info } = await import('../../src/cli/commands/info.ts')

    await info({ storyId: 'story-1' })

    expect(logSpy).toHaveBeenCalledWith('  当前章节: 3/3')
  })
})
