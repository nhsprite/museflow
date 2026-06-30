import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Story } from '../../src/types/story.ts'
import type { ReducedGraphState } from '../../src/graph/state.ts'

const requireStoryMock = vi.fn<() => Promise<Story>>()
const updateLatestStateMock = vi.fn<() => Promise<void>>()
const writeOutlineContentMock = vi.fn<() => Promise<void>>()
const getTupleMock = vi.fn()

vi.mock('../../src/cli/utils/story-loader.js', () => ({
  requireStory: requireStoryMock,
}))

vi.mock('../../src/graph/checkpointer.js', () => ({
  getCheckpointer: () => ({
    getTuple: getTupleMock,
    updateLatestState: updateLatestStateMock,
  }),
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  writeOutlineContent: writeOutlineContentMock,
}))

function makeStory(): Story {
  return {
    id: 'story-1',
    title: 'Test Story',
    idea: 'test',
    genre: 'default',
    totalChapters: 20,
    status: 'writing',
    provider: 'openai',
    outputDir: '/tmp/story-1',
    createdAt: 0,
    updatedAt: 0,
  }
}

function makeState(): ReducedGraphState {
  return {
    story: makeStory(),
    idea: 'test',
    genre: 'default',
    totalChapters: 20,
    currentChapterIndex: 3,
    chapters: [],
    outline: [
      { number: 1, title: 'A', description: 'a' },
      { number: 2, title: 'B', description: 'b' },
    ],
    storyArc: {
      totalChapters: 20,
      acts: [
        { index: 1, startChapter: 1, endChapter: 5, title: '第一幕', theme: 't', function: 'f', mandatoryBeats: [] },
        { index: 2, startChapter: 6, endChapter: 10, title: '第二幕', theme: 't', function: 'f', mandatoryBeats: [] },
        { index: 3, startChapter: 11, endChapter: 20, title: '第三幕', theme: 't', function: 'f', mandatoryBeats: [] },
      ],
      keyBeats: [],
    },
    actProgress: {},
    foreshadowStack: [],
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
  } as unknown as ReducedGraphState
}

describe('adjust-act command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireStoryMock.mockResolvedValue(makeStory())
    getTupleMock.mockResolvedValue({
      checkpoint: { channel_values: makeState() },
    })
  })

  it('rejects non-numeric act or end-chapter', async () => {
    const { adjustAct } = await import('../../src/cli/commands/adjust-act.js')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number) => never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await adjustAct('story-1', { act: 'abc', endChapter: '5' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--act 和 --end-chapter 必须是数字'))
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('updates act boundary and rewrites outline', async () => {
    const { adjustAct } = await import('../../src/cli/commands/adjust-act.js')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await adjustAct('story-1', { act: '1', endChapter: '6' })

    expect(updateLatestStateMock).toHaveBeenCalledTimes(1)
    const updatedState = updateLatestStateMock.mock.calls[0]![1] as { storyArc: { acts: Array<{ startChapter: number; endChapter: number }> } }
    expect(updatedState.storyArc.acts[0]?.endChapter).toBe(6)
    expect(updatedState.storyArc.acts[1]?.startChapter).toBe(7)
    expect(writeOutlineContentMock).toHaveBeenCalledTimes(1)
    logSpy.mockRestore()
  })
})
