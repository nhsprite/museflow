import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Story } from '../../src/types/story.ts'
import type { ReducedGraphState } from '../../src/graph/state.ts'
import type { Issue } from '../../src/types/agent.ts'

const testTempDir = join(tmpdir(), `museflow-adjust-act-${randomUUID().slice(0, 8)}`)

const requireStoryMock = vi.fn<() => Promise<Story>>()
const updateLatestStateMock = vi.fn<() => Promise<void>>()
const writeOutlineContentMock = vi.fn<() => Promise<void>>()
const exportMetaFromCheckpointMock = vi.fn<() => Promise<void>>()
const getTupleMock = vi.fn()

vi.mock('../../src/cli/utils/story-loader.js', () => ({
  requireStory: requireStoryMock,
}))

vi.mock('../../src/storage/checkpoint-service.js', () => ({
  createCheckpointService: () => ({
    getTuple: getTupleMock,
    updateLatestState: updateLatestStateMock,
  }),
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  writeOutlineContent: writeOutlineContentMock,
}))

vi.mock('../../src/storage/meta/exporter.js', () => ({
  exportMetaFromCheckpoint: exportMetaFromCheckpointMock,
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
    outputDir: testTempDir,
    createdAt: 0,
    updatedAt: 0,
  }
}

function makeState(overrides: Partial<ReducedGraphState> = {}): ReducedGraphState {
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
        {
          index: 1,
          startChapter: 1,
          endChapter: 5,
          title: '第一幕',
          theme: 't',
          function: 'f',
          mandatoryBeats: [],
        },
        {
          index: 2,
          startChapter: 6,
          endChapter: 10,
          title: '第二幕',
          theme: 't',
          function: 'f',
          mandatoryBeats: [],
        },
        {
          index: 3,
          startChapter: 11,
          endChapter: 20,
          title: '第三幕',
          theme: 't',
          function: 'f',
          mandatoryBeats: [],
        },
      ],
      keyBeats: [],
    },
    actProgress: {},
    foreshadowStack: [],
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    ...overrides,
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
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as (code?: number) => never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await adjustAct('story-1', { act: 'abc', endChapter: '5' })

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--act 和 --end-chapter 必须是数字')
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('updates act boundary and rewrites outline', async () => {
    const { adjustAct } = await import('../../src/cli/commands/adjust-act.js')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await adjustAct('story-1', { act: '1', endChapter: '6' })

    expect(updateLatestStateMock).toHaveBeenCalledTimes(1)
    const updatedState = updateLatestStateMock.mock.calls[0]![0] as {
      storyArc: { acts: Array<{ startChapter: number; endChapter: number }> }
    }
    expect(updatedState.storyArc.acts[0]?.endChapter).toBe(6)
    expect(updatedState.storyArc.acts[1]?.startChapter).toBe(7)
    expect(writeOutlineContentMock).toHaveBeenCalledTimes(1)
    logSpy.mockRestore()
  })

  it('extends an act by shifting all following acts instead of compressing the next act', async () => {
    const { adjustAct } = await import('../../src/cli/commands/adjust-act.js')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await adjustAct('story-1', { act: '1', endChapter: '7' })

    const updatedState = updateLatestStateMock.mock.calls[0]![0] as {
      storyArc: { totalChapters: number; acts: Array<{ startChapter: number; endChapter: number }> }
      totalChapters: number
      story: { totalChapters: number }
    }
    expect(updatedState.storyArc.totalChapters).toBe(22)
    expect(updatedState.totalChapters).toBe(22)
    expect(updatedState.story.totalChapters).toBe(22)
    expect(updatedState.storyArc.acts.map((act) => [act.startChapter, act.endChapter])).toEqual([
      [1, 7],
      [8, 12],
      [13, 22],
    ])
    logSpy.mockRestore()
  })

  it('clears resolved outline coverage errors for the adjusted act only', async () => {
    const issues: Issue[] = [
      {
        id: 'unverified-beat-1-0',
        type: 'outline_coverage',
        severity: 'error',
        description: '第 1 幕自动延长已达到上限，仍有 mandatory beats 未消费。',
        source: 'outline_compliance',
        retryStrategy: 'manual',
      },
      {
        id: 'auto-extension-limit-1-generated-uuid-1234',
        type: 'outline_coverage',
        severity: 'error',
        description: '第 1 幕自动延长已达到上限，仍有 mandatory beats 未消费。',
        source: 'outline_compliance',
        retryStrategy: 'manual',
      },
      {
        id: 'unverified-beat-2-0',
        type: 'outline_coverage',
        severity: 'error',
        description: '第 2 幕自动延长已达到上限，仍有 mandatory beats 未消费。',
        source: 'outline_compliance',
        retryStrategy: 'manual',
      },
      {
        id: 'consistency-info',
        type: 'consistency',
        severity: 'info',
        description: '可选的连续性提示。',
      },
    ]
    getTupleMock.mockResolvedValue({
      checkpoint: { channel_values: makeState({ pendingIssues: issues }) },
    })
    const { adjustAct } = await import('../../src/cli/commands/adjust-act.js')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await adjustAct('story-1', { act: '1', endChapter: '6' })

    const updatedState = updateLatestStateMock.mock.calls[0]![0] as { pendingIssues: Issue[] }
    expect(updatedState.pendingIssues.map((issue) => issue.id)).toEqual([
      'unverified-beat-2-0',
      'consistency-info',
    ])
    logSpy.mockRestore()
  })

  it('exports meta after updating the checkpoint state', async () => {
    const { adjustAct } = await import('../../src/cli/commands/adjust-act.js')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await adjustAct('story-1', { act: '1', endChapter: '6' })

    expect(exportMetaFromCheckpointMock).toHaveBeenCalledWith(testTempDir)
    logSpy.mockRestore()
  })
})
