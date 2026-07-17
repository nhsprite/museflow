import type { RunnableConfig } from '@langchain/core/runnables'
import type { ReducedGraphState } from '../graph/state.js'
import type { Issue } from '../types/agent.js'
import { logger } from '../utils/logger.js'
import { exportMetaFromCheckpoint } from '../storage/meta/exporter.js'
import { deleteChapterReport, saveChapterReport } from '../storage/meta/stores/chapter-report.js'
import {
  deleteChapterContent,
  deleteStagedChapterContent,
  hasStagedChapterContent,
  promoteStagedChapterContent,
  readChapterContent,
  writeOutlineContent,
} from '../storage/filesystem/writer.js'

interface ChapterCommitGraph {
  getState(config: RunnableConfig): Promise<{
    config?: RunnableConfig
  }>
}

interface ChapterCommitCheckpointService {
  saveChapterMarker(chapterNumber: number, checkpointId: string): Promise<void>
  deleteChapterMarkersFrom(chapterNumber: number): Promise<void>
  pruneIntermediateCheckpoints(): Promise<void>
  clearPendingWrites(): Promise<void>
}

interface ChapterCommitInput {
  result: ReducedGraphState
  graph: ChapterCommitGraph
  config: RunnableConfig
  checkpointService: ChapterCommitCheckpointService
  outputDir: string
  /**
   * 0-based index of the chapter being rewritten. When set, downstream chapter
   * files, staged files, reports and chapter markers are truncated here — after
   * the new marker has been saved — instead of before the graph run.
   */
  truncateAfterChapter?: number
}

function shouldSaveChapterMarker(result: ReducedGraphState): boolean {
  return !result.rewriteRequested && result.isWriting && result.currentChapterIndex > 0
}

/**
 * Recovery reconciliation for crashed commit boundaries.
 *
 * If the process died after the finalize checkpoint was persisted but before
 * the staged chapter content was promoted, chapters/ misses a file that
 * .staging/chapters/ still holds. Promote it; when both are missing, emit a
 * structured draft_failure issue so the run can surface a rewrite prompt.
 */
export async function reconcileStagedChapterCommits(
  outputDir: string,
  currentChapterIndex: number,
  storyId: string
): Promise<Issue[]> {
  const issues: Issue[] = []
  for (let i = 0; i < currentChapterIndex; i++) {
    const chapterNumber = i + 1
    const content = await readChapterContent(outputDir, chapterNumber)
    if (content !== null && content.trim().length > 0) continue

    if (hasStagedChapterContent(outputDir, chapterNumber)) {
      await promoteStagedChapterContent(outputDir, chapterNumber)
      logger.info(`[MuseFlow] 恢复对账：已补提第 ${chapterNumber} 章的暂存正文`)
      continue
    }

    logger.warn(`[MuseFlow] 恢复对账：第 ${chapterNumber} 章已完成但正文文件缺失`)
    issues.push({
      id: `chapter-${chapterNumber}-content-missing`,
      ruleId: 'finalization.chapter-content-missing',
      type: 'draft_failure',
      severity: 'error',
      subject: `chapter-${chapterNumber}`,
      description: `第 ${chapterNumber} 章已标记完成但正文文件缺失（commit 被中断）。请运行 museflow rewrite ${storyId} -c ${chapterNumber} 重写该章。`,
      suggestion: `museflow rewrite ${storyId} -c ${chapterNumber}`,
      source: 'state_reconciliation',
      retryStrategy: 'manual',
    })
  }
  return issues
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
  truncateAfterChapter,
}: ChapterCommitInput): Promise<void> {
  if (shouldSaveChapterMarker(result)) {
    await promoteStagedChapterContent(outputDir, result.currentChapterIndex)

    const stateAfter = await graph.getState(config)
    const checkpointId = stateAfter.config?.configurable?.checkpoint_id as string | undefined
    if (checkpointId) {
      await checkpointService.saveChapterMarker(result.currentChapterIndex, checkpointId)
    }

    if (truncateAfterChapter !== undefined) {
      const totalChapters = result.totalChapters ?? truncateAfterChapter + 1
      for (let ch = truncateAfterChapter + 2; ch <= totalChapters; ch++) {
        await deleteChapterContent(outputDir, ch)
        await deleteStagedChapterContent(outputDir, ch)
        deleteChapterReport(outputDir, ch - 1)
      }
      await checkpointService.deleteChapterMarkersFrom(truncateAfterChapter + 1)
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

  await exportMetaFromCheckpoint(outputDir).catch(() => {})
  await checkpointService.pruneIntermediateCheckpoints().catch(() => {})
  await checkpointService.clearPendingWrites().catch(() => {})
}
