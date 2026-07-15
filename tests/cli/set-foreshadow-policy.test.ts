import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReducedGraphState } from '../../src/graph/state.js'
import { applyEvents, createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import type { StoryMemory } from '../../src/types/story-memory.js'
import type { Story } from '../../src/types/story.js'

const testTempDir = join(tmpdir(), `museflow-set-foreshadow-policy-${randomUUID().slice(0, 8)}`)

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

function makeMemory(): StoryMemory {
  return applyEvents(createEmptyStoryMemory(), [
    {
      id: 'e-intro-active',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-active',
      text: '仍然活跃的线索',
      kind: 'other',
      resolutionPolicy: 'should_resolve',
      required: true,
      expectedFulfillChapter: null,
      chapterIndex: 0,
      source: 'chapter',
    },
    {
      id: 'e-intro-fulfilled',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-fulfilled',
      text: '已经回收的线索',
      kind: 'other',
      resolutionPolicy: 'should_resolve',
      required: true,
      expectedFulfillChapter: null,
      chapterIndex: 0,
      source: 'chapter',
    },
    {
      id: 'e-fulfill',
      type: 'foreshadow-fulfill',
      foreshadowId: 'fs-fulfilled',
      chapterIndex: 1,
      source: 'chapter',
    },
    {
      id: 'e-intro-waived',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-waived',
      text: '已经放弃的线索',
      kind: 'other',
      resolutionPolicy: 'should_resolve',
      required: true,
      expectedFulfillChapter: null,
      chapterIndex: 0,
      source: 'chapter',
    },
    {
      id: 'e-waive',
      type: 'foreshadow-waive',
      foreshadowId: 'fs-waived',
      chapterIndex: 2,
      source: 'outline',
    },
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
        id: 'fs-active',
        text: '仍然活跃的线索',
        expectedFulfillChapter: Number.MAX_SAFE_INTEGER,
        createdAt: 0,
        createdAtChapter: 1,
        status: 'planted',
        isExplicit: true,
        resolutionPolicy: 'should_resolve',
        required: true,
        kind: 'other',
      },
    ],
    pendingIssues: [],
    verifiedConstraints: [],
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

describe('set-foreshadow-policy command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireStoryMock.mockResolvedValue(makeStory())
    getTupleMock.mockResolvedValue({
      checkpoint: { channel_values: makeState() },
    })
  })

  it('requires a deadline for must_resolve', async () => {
    const { setForeshadowPolicy } = await import('../../src/cli/commands/set-foreshadow-policy.js')
    const { exitSpy, errorSpy } = spyOnExit()

    await setForeshadowPolicy('story-1', {
      foreshadow: 'fs-active',
      policy: 'must_resolve',
    })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('必须提供 --deadline'))
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(updateLatestStateMock).not.toHaveBeenCalled()
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('rejects a deadline for non-mandatory policies', async () => {
    const { setForeshadowPolicy } = await import('../../src/cli/commands/set-foreshadow-policy.js')
    const { exitSpy, errorSpy } = spyOnExit()

    await setForeshadowPolicy('story-1', {
      foreshadow: 'fs-active',
      policy: 'should_resolve',
      deadline: 12,
    })

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--deadline 仅适用于 must_resolve')
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(updateLatestStateMock).not.toHaveBeenCalled()
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('rejects a mandatory deadline that is not after the introduction chapter', async () => {
    const { setForeshadowPolicy } = await import('../../src/cli/commands/set-foreshadow-policy.js')
    const { exitSpy, errorSpy } = spyOnExit()

    await setForeshadowPolicy('story-1', {
      foreshadow: 'fs-active',
      policy: 'must_resolve',
      deadline: 1,
    })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('必须晚于伏笔引入章节'))
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(updateLatestStateMock).not.toHaveBeenCalled()
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it.each([
    ['unknown', 'fs-unknown', '不存在'],
    ['fulfilled', 'fs-fulfilled', '已在第 2 章回收'],
    ['waived', 'fs-waived', '已经放弃回收'],
  ])('rejects an %s target', async (_label, foreshadow, message) => {
    const { setForeshadowPolicy } = await import('../../src/cli/commands/set-foreshadow-policy.js')
    const { exitSpy, errorSpy } = spyOnExit()

    await setForeshadowPolicy('story-1', {
      foreshadow,
      policy: 'may_remain_open',
    })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(message))
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(updateLatestStateMock).not.toHaveBeenCalled()
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('appends a policy-set event and reprojects the active stack', async () => {
    const { setForeshadowPolicy } = await import('../../src/cli/commands/set-foreshadow-policy.js')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await setForeshadowPolicy('story-1', {
      foreshadow: 'fs-active',
      policy: 'must_resolve',
      deadline: 12,
    })

    expect(updateLatestStateMock).toHaveBeenCalledTimes(1)
    const updated = updateLatestStateMock.mock.calls[0]![0] as {
      storyMemory: StoryMemory
      foreshadowStack: Array<{
        id: string
        resolutionPolicy?: string
        expectedFulfillChapter: number
        required: boolean
      }>
    }
    expect(updated.storyMemory.foreshadows['fs-active']).toMatchObject({
      resolutionPolicy: 'must_resolve',
      expectedFulfillChapter: 12,
      required: true,
    })
    expect(updated.storyMemory.events.at(-1)).toMatchObject({
      type: 'foreshadow-policy-set',
      foreshadowId: 'fs-active',
      resolutionPolicy: 'must_resolve',
      expectedFulfillChapter: 12,
      chapterIndex: 3,
      source: 'outline',
    })
    expect(updated.foreshadowStack).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'fs-active',
          resolutionPolicy: 'must_resolve',
          expectedFulfillChapter: 12,
          required: true,
        }),
      ])
    )
    expect(exportMetaFromCheckpointMock).toHaveBeenCalledWith(testTempDir)
    logSpy.mockRestore()
  })

  it('clears stale boundary state after a policy change', async () => {
    getTupleMock.mockResolvedValue({
      checkpoint: {
        channel_values: makeState({
          pendingIssues: [
            {
              id: 'boundary-fs-active',
              type: 'foreshadow_boundary_unresolved',
              severity: 'error',
              description: '旧边界问题',
              subject: 'fs-active',
              source: 'foreshadowing',
              retryStrategy: 'draft',
            },
          ],
          verifiedConstraints: [
            {
              kind: 'generic',
              id: 'foreshadow-boundary:fs-active',
              text: '旧边界约束',
            },
            { kind: 'generic', id: 'manual:keep', text: '保留的约束' },
          ],
        }),
      },
    })
    const { setForeshadowPolicy } = await import('../../src/cli/commands/set-foreshadow-policy.js')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await setForeshadowPolicy('story-1', {
      foreshadow: 'fs-active',
      policy: 'may_remain_open',
    })

    const updated = updateLatestStateMock.mock.calls[0]![0] as {
      pendingIssues: unknown[]
      verifiedConstraints: Array<{ id?: string }>
    }
    expect(updated.pendingIssues).toEqual([])
    expect(updated.verifiedConstraints.map((constraint) => constraint.id)).toEqual(['manual:keep'])
    logSpy.mockRestore()
  })
})
