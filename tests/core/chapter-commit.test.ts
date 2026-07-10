import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { ReducedGraphState } from '../../src/graph/state.js'

const {
  exportMetaFromCheckpointMock,
  promoteStagedChapterContentMock,
  deleteStagedChapterContentMock,
  writeOutlineContentMock,
  saveChapterReportMock,
} = vi.hoisted(() => ({
  exportMetaFromCheckpointMock: vi.fn().mockResolvedValue(undefined),
  promoteStagedChapterContentMock: vi.fn().mockResolvedValue(true),
  deleteStagedChapterContentMock: vi.fn().mockResolvedValue(undefined),
  writeOutlineContentMock: vi.fn().mockResolvedValue(undefined),
  saveChapterReportMock: vi.fn(),
}))

vi.mock('../../src/storage/meta/exporter.js', () => ({
  exportMetaFromCheckpoint: exportMetaFromCheckpointMock,
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  promoteStagedChapterContent: promoteStagedChapterContentMock,
  deleteStagedChapterContent: deleteStagedChapterContentMock,
  writeOutlineContent: writeOutlineContentMock,
}))

vi.mock('../../src/storage/meta/stores/chapter-report.js', () => ({
  saveChapterReport: saveChapterReportMock,
}))

describe('chapter commit boundary', () => {
  const checkpointService = {
    saveChapterMarker: vi.fn().mockResolvedValue(undefined),
    pruneIntermediateCheckpoints: vi.fn().mockResolvedValue(undefined),
    clearPendingWrites: vi.fn().mockResolvedValue(undefined),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    promoteStagedChapterContentMock.mockResolvedValue(true)
    deleteStagedChapterContentMock.mockResolvedValue(undefined)
    writeOutlineContentMock.mockResolvedValue(undefined)
    exportMetaFromCheckpointMock.mockResolvedValue(undefined)
    checkpointService.saveChapterMarker.mockResolvedValue(undefined)
    checkpointService.pruneIntermediateCheckpoints.mockResolvedValue(undefined)
    checkpointService.clearPendingWrites.mockResolvedValue(undefined)
  })

  it('saves a chapter marker from the persisted graph checkpoint and exports meta projection', async () => {
    const { commitChapterRun } = await import('../../src/core/chapter-commit.js')
    const outputDir = '/tmp/museflow-commit-test'
    const config: RunnableConfig = { configurable: { thread_id: 'story-1', outputDir } }
    const graph = {
      getState: vi.fn().mockResolvedValue({
        config: { configurable: { checkpoint_id: 'ckpt-finalized' } },
      }),
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

    expect(promoteStagedChapterContentMock).toHaveBeenCalledWith(outputDir, 2)
    expect(graph.getState).toHaveBeenCalledWith(config)
    expect(checkpointService.saveChapterMarker).toHaveBeenCalledWith(2, 'ckpt-finalized')
    expect(exportMetaFromCheckpointMock).toHaveBeenCalledWith(outputDir)
    expect(checkpointService.pruneIntermediateCheckpoints).toHaveBeenCalled()
    expect(checkpointService.clearPendingWrites).toHaveBeenCalled()
  })

  it('exports meta projection without saving a marker when the chapter did not commit', async () => {
    const { commitChapterRun } = await import('../../src/core/chapter-commit.js')
    const outputDir = '/tmp/museflow-commit-test'
    const graph = {
      getState: vi.fn(),
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

    expect(deleteStagedChapterContentMock).toHaveBeenCalledWith(outputDir, 3)
    expect(promoteStagedChapterContentMock).not.toHaveBeenCalled()
    expect(graph.getState).not.toHaveBeenCalled()
    expect(checkpointService.saveChapterMarker).not.toHaveBeenCalled()
    expect(exportMetaFromCheckpointMock).toHaveBeenCalledWith(outputDir)
  })

  it('writes chapter report and outline projections after the graph has persisted final state', async () => {
    const { commitChapterRun } = await import('../../src/core/chapter-commit.js')
    const outputDir = '/tmp/museflow-commit-test'
    const graph = {
      getState: vi.fn().mockResolvedValue({
        config: { configurable: { checkpoint_id: 'ckpt-finalized' } },
      }),
    }
    const chapterReport = { chapterIndex: 0, storyId: 'story-1' }
    const storyArc = { totalChapters: 1, acts: [], keyBeats: [] }
    const outline = [{ number: 1, title: 'A', description: 'B' }]

    await commitChapterRun({
      result: {
        rewriteRequested: false,
        isWriting: true,
        currentChapterIndex: 1,
        story: { id: 'story-1', title: 'Story', outputDir },
        outline,
        storyArc,
        chapterReport,
      } as unknown as ReducedGraphState,
      graph,
      config: { configurable: { thread_id: 'story-1', outputDir } },
      checkpointService,
      outputDir,
    })

    expect(saveChapterReportMock).toHaveBeenCalledWith(outputDir, chapterReport)
    expect(writeOutlineContentMock).toHaveBeenCalledWith(outputDir, 'Story', outline, storyArc)
  })
})
