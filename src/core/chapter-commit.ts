import type { RunnableConfig } from '@langchain/core/runnables'
import type { ReducedGraphState } from '../graph/state.js'
import { exportMetaFromCheckpoint } from '../storage/meta/exporter.js'
import { saveChapterReport } from '../storage/meta/stores/chapter-report.js'
import {
  deleteStagedChapterContent,
  promoteStagedChapterContent,
  writeOutlineContent,
} from '../storage/filesystem/writer.js'

interface ChapterCommitGraph {
  getState(config: RunnableConfig): Promise<{
    config?: RunnableConfig
  }>
}

interface ChapterCommitCheckpointService {
  saveChapterMarker(chapterNumber: number, checkpointId: string): Promise<void>
  pruneIntermediateCheckpoints(): Promise<void>
  clearPendingWrites(): Promise<void>
}

interface ChapterCommitInput {
  result: ReducedGraphState
  graph: ChapterCommitGraph
  config: RunnableConfig
  checkpointService: ChapterCommitCheckpointService
  outputDir: string
}

function shouldSaveChapterMarker(result: ReducedGraphState): boolean {
  return !result.rewriteRequested && result.isWriting && result.currentChapterIndex > 0
}

/**
 * Commit boundary for a completed chapter graph run.
 *
 * LangGraph persists the final node state after the node returns, so chapter
 * marker and meta projection writes must happen after graph.invoke completes.
 * This keeps that post-graph commit sequence in one explicit place.
 */
export async function commitChapterRun({
  result,
  graph,
  config,
  checkpointService,
  outputDir,
}: ChapterCommitInput): Promise<void> {
  if (shouldSaveChapterMarker(result)) {
    await promoteStagedChapterContent(outputDir, result.currentChapterIndex)

    const stateAfter = await graph.getState(config)
    const checkpointId = stateAfter.config?.configurable?.checkpoint_id as string | undefined
    if (checkpointId) {
      await checkpointService.saveChapterMarker(result.currentChapterIndex, checkpointId)
    }
  } else {
    await deleteStagedChapterContent(outputDir, result.currentChapterIndex + 1)
  }

  if (result.chapterReport) {
    saveChapterReport(outputDir, result.chapterReport)
  }

  if (result.storyArc) {
    await writeOutlineContent(outputDir, result.story.title, result.outline, result.storyArc)
  }

  await exportMetaFromCheckpoint(outputDir)
  await checkpointService.pruneIntermediateCheckpoints().catch(() => {})
  await checkpointService.clearPendingWrites().catch(() => {})
}
