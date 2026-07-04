import { describe, expect, it, vi } from 'vitest'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { ReducedGraphState } from '../../src/graph/state.js'

const { exportMetaFromCheckpointMock } = vi.hoisted(() => ({
  exportMetaFromCheckpointMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/storage/meta/exporter.js', () => ({
  exportMetaFromCheckpoint: exportMetaFromCheckpointMock,
}))

describe('chapter commit boundary', () => {
  it('saves a chapter marker from the persisted graph checkpoint and exports meta projection', async () => {
    const { commitChapterRun } = await import('../../src/core/chapter-commit.js')
    const outputDir = '/tmp/museflow-commit-test'
    const config: RunnableConfig = { configurable: { thread_id: 'story-1', outputDir } }
    const graph = {
      getState: vi.fn().mockResolvedValue({
        config: { configurable: { checkpoint_id: 'ckpt-finalized' } },
      }),
    }
    const checkpointService = {
      saveChapterMarker: vi.fn().mockResolvedValue(undefined),
    }

    await commitChapterRun({
      result: {
        rewriteRequested: false,
        isWriting: true,
        currentChapterIndex: 2,
      } as ReducedGraphState,
      graph,
      config,
      checkpointService,
      outputDir,
    })

    expect(graph.getState).toHaveBeenCalledWith(config)
    expect(checkpointService.saveChapterMarker).toHaveBeenCalledWith(2, 'ckpt-finalized')
    expect(exportMetaFromCheckpointMock).toHaveBeenCalledWith(outputDir)
  })

  it('exports meta projection without saving a marker when the chapter did not commit', async () => {
    const { commitChapterRun } = await import('../../src/core/chapter-commit.js')
    const outputDir = '/tmp/museflow-commit-test'
    const graph = {
      getState: vi.fn(),
    }
    const checkpointService = {
      saveChapterMarker: vi.fn(),
    }

    await commitChapterRun({
      result: {
        rewriteRequested: true,
        isWriting: true,
        currentChapterIndex: 2,
      } as ReducedGraphState,
      graph,
      config: { configurable: { thread_id: 'story-1', outputDir } },
      checkpointService,
      outputDir,
    })

    expect(graph.getState).not.toHaveBeenCalled()
    expect(checkpointService.saveChapterMarker).not.toHaveBeenCalled()
    expect(exportMetaFromCheckpointMock).toHaveBeenCalledWith(outputDir)
  })
})
