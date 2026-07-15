import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Story } from '../../src/types/story.ts'
import type { ReducedGraphState } from '../../src/graph/state.ts'
import type { Issue } from '../../src/types/agent.ts'
import type { StoryMemory } from '../../src/types/story-memory.ts'
import { applyEvents, createEmptyStoryMemory } from '../../src/story-memory/projector.ts'

const testTempDir = join(tmpdir(), `museflow-waive-foreshadow-${randomUUID().slice(0, 8)}`)

const requireStoryMock = vi.fn<() => Promise<Story>>()
const updateLatestStateMock = vi.fn<() => Promise<void>>()
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

function makeMemory(extraEvents: StoryMemory['events'] = []): StoryMemory {
  return applyEvents(createEmptyStoryMemory(), [
    {
      id: 'e-intro-1',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-1',
      text: '未回收的线索',
      expectedFulfillChapter: null,
      chapterIndex: 0,
      source: 'chapter',
    },
    {
      id: 'e-intro-2',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-2',
      expectedFulfillChapter: 10,
      chapterIndex: 0,
      source: 'chapter',
    },
    {
      id: 'e-fulfill-2',
      type: 'foreshadow-fulfill',
      foreshadowId: 'fs-2',
      chapterIndex: 2,
      source: 'chapter',
    },
    ...extraEvents,
  ])
}

function makeState(overrides: Partial<ReducedGraphState> = {}): ReducedGraphState {
  return {
    story: makeStory(),
    idea: 'test',
    genre: 'default',
    totalChapters: 20,
    currentChapterIndex: 3,
    storyMemory: makeMemory(),
    foreshadowStack: [
      {
        id: 'fs-1',
        text: '未回收的线索',
        expectedFulfillChapter: Number.MAX_SAFE_INTEGER,
        createdAt: 0,
        createdAtChapter: 1,
        status: 'planted',
        isExplicit: true,
        required: true,
      },
    ],
    pendingIssues: [],
    ...overrides,
  } as unknown as ReducedGraphState
}

function spyOnExit() {
  const exitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation((() => {}) as (code?: number) => never)
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  return { exitSpy, errorSpy }
}

describe('waive-foreshadow command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireStoryMock.mockResolvedValue(makeStory())
    getTupleMock.mockResolvedValue({
      checkpoint: { channel_values: makeState() },
    })
  })

  it('rejects a missing foreshadow id', async () => {
    const { waiveForeshadow } = await import('../../src/cli/commands/waive-foreshadow.js')
    const { exitSpy, errorSpy } = spyOnExit()

    await waiveForeshadow('story-1', {})

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('请提供故事ID和伏笔ID'))
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(updateLatestStateMock).not.toHaveBeenCalled()
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('rejects an unknown foreshadow', async () => {
    const { waiveForeshadow } = await import('../../src/cli/commands/waive-foreshadow.js')
    const { exitSpy, errorSpy } = spyOnExit()

    await waiveForeshadow('story-1', { foreshadow: 'fs-unknown' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('伏笔 fs-unknown 不存在'))
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(updateLatestStateMock).not.toHaveBeenCalled()
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('rejects an already fulfilled foreshadow', async () => {
    const { waiveForeshadow } = await import('../../src/cli/commands/waive-foreshadow.js')
    const { exitSpy, errorSpy } = spyOnExit()

    await waiveForeshadow('story-1', { foreshadow: 'fs-2' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('已在第 3 章回收'))
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(updateLatestStateMock).not.toHaveBeenCalled()
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('rejects an already waived foreshadow', async () => {
    getTupleMock.mockResolvedValue({
      checkpoint: {
        channel_values: makeState({
          storyMemory: makeMemory([
            {
              id: 'e-waive-1',
              type: 'foreshadow-waive',
              foreshadowId: 'fs-1',
              chapterIndex: 2,
              source: 'outline',
            },
          ]),
        }),
      },
    })
    const { waiveForeshadow } = await import('../../src/cli/commands/waive-foreshadow.js')
    const { exitSpy, errorSpy } = spyOnExit()

    await waiveForeshadow('story-1', { foreshadow: 'fs-1' })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('已经放弃回收'))
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(updateLatestStateMock).not.toHaveBeenCalled()
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('waives a foreshadow by appending a foreshadow-waive event', async () => {
    const { waiveForeshadow } = await import('../../src/cli/commands/waive-foreshadow.js')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await waiveForeshadow('story-1', { foreshadow: 'fs-1', reason: '主题需要悬置' })

    expect(updateLatestStateMock).toHaveBeenCalledTimes(1)
    const updated = updateLatestStateMock.mock.calls[0]![0] as {
      storyMemory: StoryMemory
      foreshadowStack: Array<{ id: string }>
      pendingIssues: Issue[]
    }
    expect(updated.storyMemory.foreshadows['fs-1']?.waivedIn).toBe(3)
    expect(updated.storyMemory.foreshadows['fs-2']?.waivedIn).toBeUndefined()
    const waiveEvent = updated.storyMemory.events.find((event) => event.type === 'foreshadow-waive')
    expect(waiveEvent).toMatchObject({
      type: 'foreshadow-waive',
      foreshadowId: 'fs-1',
      chapterIndex: 3,
      reason: '主题需要悬置',
    })
    expect(updated.foreshadowStack).toEqual([])
    expect(exportMetaFromCheckpointMock).toHaveBeenCalledWith(testTempDir)
    logSpy.mockRestore()
  })

  it('clears the boundary blocking issue for the waived foreshadow only', async () => {
    const issues: Issue[] = [
      {
        id: 'foreshadow-boundary-unresolved-fs-1-3',
        type: 'foreshadow_boundary_unresolved',
        severity: 'error',
        description: '全书结尾仍有必需伏笔 fs-1 未回收',
        subject: 'fs-1',
        source: 'foreshadowing',
        retryStrategy: 'draft',
      },
      {
        id: 'foreshadow-boundary-unresolved-fs-9-3',
        type: 'foreshadow_boundary_unresolved',
        severity: 'error',
        description: '全书结尾仍有必需伏笔 fs-9 未回收',
        subject: 'fs-9',
        source: 'foreshadowing',
        retryStrategy: 'draft',
      },
    ]
    getTupleMock.mockResolvedValue({
      checkpoint: { channel_values: makeState({ pendingIssues: issues }) },
    })
    const { waiveForeshadow } = await import('../../src/cli/commands/waive-foreshadow.js')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await waiveForeshadow('story-1', { foreshadow: 'fs-1' })

    const updated = updateLatestStateMock.mock.calls[0]![0] as { pendingIssues: Issue[] }
    expect(updated.pendingIssues.map((issue) => issue.subject)).toEqual(['fs-9'])
    logSpy.mockRestore()
  })
})
