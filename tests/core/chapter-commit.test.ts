import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { ReducedGraphState } from '../../src/graph/state.js'

const {
  exportMetaFromCheckpointMock,
  promoteStagedChapterContentMock,
  deleteChapterContentMock,
  deleteStagedChapterContentMock,
  hasStagedChapterContentMock,
  readChapterContentMock,
  writeOutlineContentMock,
  saveChapterReportMock,
  deleteChapterReportMock,
} = vi.hoisted(() => ({
  exportMetaFromCheckpointMock: vi.fn().mockResolvedValue(undefined),
  promoteStagedChapterContentMock: vi.fn().mockResolvedValue(true),
  deleteChapterContentMock: vi.fn().mockResolvedValue(undefined),
  deleteStagedChapterContentMock: vi.fn().mockResolvedValue(undefined),
  hasStagedChapterContentMock: vi.fn().mockReturnValue(false),
  readChapterContentMock: vi.fn().mockResolvedValue('chapter content'),
  writeOutlineContentMock: vi.fn().mockResolvedValue(undefined),
  saveChapterReportMock: vi.fn(),
  deleteChapterReportMock: vi.fn(),
}))

vi.mock('../../src/storage/meta/exporter.js', () => ({
  exportMetaFromCheckpoint: exportMetaFromCheckpointMock,
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  promoteStagedChapterContent: promoteStagedChapterContentMock,
  deleteChapterContent: deleteChapterContentMock,
  deleteStagedChapterContent: deleteStagedChapterContentMock,
  hasStagedChapterContent: hasStagedChapterContentMock,
  readChapterContent: readChapterContentMock,
  writeOutlineContent: writeOutlineContentMock,
}))

vi.mock('../../src/storage/meta/stores/chapter-report.js', () => ({
  saveChapterReport: saveChapterReportMock,
  deleteChapterReport: deleteChapterReportMock,
}))

describe('chapter commit boundary', () => {
  const checkpointService = {
    saveChapterMarker: vi.fn().mockResolvedValue(undefined),
    deleteChapterMarkersFrom: vi.fn().mockResolvedValue(undefined),
    pruneIntermediateCheckpoints: vi.fn().mockResolvedValue(undefined),
    clearPendingWrites: vi.fn().mockResolvedValue(undefined),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    promoteStagedChapterContentMock.mockResolvedValue(true)
    deleteChapterContentMock.mockResolvedValue(undefined)
    deleteStagedChapterContentMock.mockResolvedValue(undefined)
    hasStagedChapterContentMock.mockReturnValue(false)
    readChapterContentMock.mockResolvedValue('chapter content')
    writeOutlineContentMock.mockResolvedValue(undefined)
    exportMetaFromCheckpointMock.mockResolvedValue(undefined)
    checkpointService.saveChapterMarker.mockResolvedValue(undefined)
    checkpointService.deleteChapterMarkersFrom.mockResolvedValue(undefined)
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

  it('truncates downstream files, reports and markers after the marker is saved when truncateAfterChapter is set', async () => {
    const { commitChapterRun } = await import('../../src/core/chapter-commit.js')
    const outputDir = '/tmp/museflow-commit-test'
    const graph = {
      getState: vi.fn().mockResolvedValue({
        config: { configurable: { checkpoint_id: 'ckpt-finalized' } },
      }),
    }

    await commitChapterRun({
      result: {
        rewriteRequested: false,
        isWriting: true,
        currentChapterIndex: 3,
        totalChapters: 5,
      } as ReducedGraphState,
      graph,
      config: { configurable: { thread_id: 'story-1', outputDir } },
      checkpointService,
      outputDir,
      truncateAfterChapter: 2,
    })

    expect(deleteChapterContentMock).toHaveBeenCalledTimes(2)
    expect(deleteChapterContentMock).toHaveBeenNthCalledWith(1, outputDir, 4)
    expect(deleteChapterContentMock).toHaveBeenNthCalledWith(2, outputDir, 5)
    expect(deleteStagedChapterContentMock).toHaveBeenCalledWith(outputDir, 4)
    expect(deleteStagedChapterContentMock).toHaveBeenCalledWith(outputDir, 5)
    expect(deleteChapterReportMock).toHaveBeenCalledWith(outputDir, 3)
    expect(deleteChapterReportMock).toHaveBeenCalledWith(outputDir, 4)
    expect(checkpointService.deleteChapterMarkersFrom).toHaveBeenCalledWith(3)
    // truncation happens only after the new marker is safely persisted
    expect(checkpointService.saveChapterMarker.mock.invocationCallOrder[0]!).toBeLessThan(
      deleteChapterContentMock.mock.invocationCallOrder[0]!
    )
    expect(checkpointService.saveChapterMarker.mock.invocationCallOrder[0]!).toBeLessThan(
      checkpointService.deleteChapterMarkersFrom.mock.invocationCallOrder[0]!
    )
  })

  it('does not truncate anything when the chapter did not commit', async () => {
    const { commitChapterRun } = await import('../../src/core/chapter-commit.js')
    const outputDir = '/tmp/museflow-commit-test'

    await commitChapterRun({
      result: {
        rewriteRequested: true,
        isWriting: true,
        currentChapterIndex: 2,
        totalChapters: 5,
      } as ReducedGraphState,
      graph: { getState: vi.fn() },
      config: { configurable: { thread_id: 'story-1', outputDir } },
      checkpointService,
      outputDir,
      truncateAfterChapter: 2,
    })

    expect(deleteChapterContentMock).not.toHaveBeenCalled()
    expect(deleteChapterReportMock).not.toHaveBeenCalled()
    expect(checkpointService.deleteChapterMarkersFrom).not.toHaveBeenCalled()
  })

  it('does not fail the committed chapter when meta projection export throws', async () => {
    const { commitChapterRun } = await import('../../src/core/chapter-commit.js')
    const outputDir = '/tmp/museflow-commit-test'
    exportMetaFromCheckpointMock.mockRejectedValue(new Error('projection failed'))

    await expect(
      commitChapterRun({
        result: {
          rewriteRequested: false,
          isWriting: true,
          currentChapterIndex: 1,
        } as ReducedGraphState,
        graph: {
          getState: vi.fn().mockResolvedValue({
            config: { configurable: { checkpoint_id: 'ckpt-finalized' } },
          }),
        },
        config: { configurable: { thread_id: 'story-1', outputDir } },
        checkpointService,
        outputDir,
      })
    ).resolves.toBeUndefined()

    expect(checkpointService.saveChapterMarker).toHaveBeenCalled()
    expect(checkpointService.pruneIntermediateCheckpoints).toHaveBeenCalled()
  })
})

describe('reconcileStagedChapterCommits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    promoteStagedChapterContentMock.mockResolvedValue(true)
    hasStagedChapterContentMock.mockReturnValue(false)
    readChapterContentMock.mockResolvedValue('chapter content')
  })

  it('promotes staged content for committed chapters whose final file is missing', async () => {
    const { reconcileStagedChapterCommits } = await import('../../src/core/chapter-commit.js')
    readChapterContentMock.mockImplementation((_dir: string, chapterNumber: number) =>
      Promise.resolve(chapterNumber === 2 ? null : 'chapter content')
    )
    hasStagedChapterContentMock.mockImplementation(
      (_dir: string, chapterNumber: number) => chapterNumber === 2
    )

    const issues = await reconcileStagedChapterCommits('/tmp/story', 3, 'story-1')

    expect(promoteStagedChapterContentMock).toHaveBeenCalledTimes(1)
    expect(promoteStagedChapterContentMock).toHaveBeenCalledWith('/tmp/story', 2)
    expect(issues).toEqual([])
  })

  it('injects a structured draft_failure issue when both final and staged files are missing', async () => {
    const { reconcileStagedChapterCommits } = await import('../../src/core/chapter-commit.js')
    readChapterContentMock.mockResolvedValue(null)
    hasStagedChapterContentMock.mockReturnValue(false)

    const issues = await reconcileStagedChapterCommits('/tmp/story', 2, 'story-1')

    expect(promoteStagedChapterContentMock).not.toHaveBeenCalled()
    expect(issues).toEqual([
      expect.objectContaining({
        id: 'chapter-1-content-missing',
        type: 'draft_failure',
        severity: 'error',
        subject: 'chapter-1',
        source: 'state_reconciliation',
        retryStrategy: 'manual',
      }),
      expect.objectContaining({
        id: 'chapter-2-content-missing',
        type: 'draft_failure',
        severity: 'error',
        subject: 'chapter-2',
        source: 'state_reconciliation',
        retryStrategy: 'manual',
      }),
    ])
  })

  it('does nothing when all committed chapters have final content', async () => {
    const { reconcileStagedChapterCommits } = await import('../../src/core/chapter-commit.js')

    const issues = await reconcileStagedChapterCommits('/tmp/story', 2, 'story-1')

    expect(promoteStagedChapterContentMock).not.toHaveBeenCalled()
    expect(issues).toEqual([])
  })
})
