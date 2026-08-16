import type { RunnableConfig } from '@langchain/core/runnables'
import type { ReducedGraphState } from '../graph/state.js'
import type { Issue } from '../types/agent.js'
import type { BlockingReport } from '../types/blocking-report.js'
import { logger } from '../utils/logger.js'
import { generateId } from '../utils/id.js'
import { exportMetaFromCheckpoint } from '../storage/meta/exporter.js'
import { deleteChapterReport, saveChapterReport } from '../storage/meta/stores/chapter-report.js'
import {
  deleteChapterContent,
  deleteStagedChapterContent,
  hasStagedChapterContent,
  promoteStagedChapterContent,
  readChapterContent,
  readChapterContentForRun,
  writeOutlineContent,
} from '../storage/filesystem/writer.js'
import {
  buildProseHygieneContext,
  checkProseHygiene,
  formatProseHygieneIssue,
} from '../graph/services/prose-hygiene/index.js'

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
  saveBlockingReport(report: BlockingReport): Promise<void>
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
 * commit 边界的最后一道确定性防线：promote 暂存正文前对体例做最终干跑校验。
 * 命中 error 级 issue 时中止 commit（不 promote、不保存章节标记），
 * 落一份 blocking report 并抛出错误，绝不静默放行受污染正文。
 */
async function assertStagedChapterHygiene(
  result: ReducedGraphState,
  outputDir: string,
  checkpointService: ChapterCommitCheckpointService
): Promise<void> {
  const chapterNumber = result.currentChapterIndex
  // 只检查本次运行写出的暂存正文；暂存缺失时没有可提交的内容，无需校验。
  if (!hasStagedChapterContent(outputDir, chapterNumber)) return
  const staged = await readChapterContentForRun(outputDir, chapterNumber)
  if (!staged || staged.trim().length === 0) return

  const hygieneIssues = checkProseHygiene(
    staged,
    buildProseHygieneContext({
      storyMemory: result.storyMemory,
      storyArc: result.storyArc,
      chapterNumber,
      totalChapters: result.totalChapters,
    })
  ).filter((issue) => issue.severity === 'error')
  if (hygieneIssues.length === 0) return

  const details = hygieneIssues
    .slice(0, 10)
    .map((issue) => formatProseHygieneIssue(issue))
    .join('；')
  const storyId = result.story?.id ?? 'unknown'
  const report: BlockingReport = {
    id: generateId('block'),
    storyId,
    chapterIndex: chapterNumber - 1,
    createdAt: Date.now(),
    reason: 'prose_hygiene',
    summary: `第 ${chapterNumber} 章在 commit 边界未通过正文体例检查（${hygieneIssues.length} 处残留），已中止提交。`,
    issues: hygieneIssues.map((issue, index) => ({
      id: `prose-hygiene-${chapterNumber}-${index + 1}`,
      ruleId: issue.code,
      type: 'draft_failure' as const,
      severity: 'error' as const,
      subject: `chapter-${chapterNumber}`,
      description: `第 ${chapterNumber} 章正文在 commit 边界检出体例残留：${formatProseHygieneIssue(issue)}`,
      suggestion: `museflow rewrite ${storyId} -c ${chapterNumber}`,
      source: 'quality' as const,
      retryStrategy: 'manual' as const,
    })),
    conflicts: [],
    suggestedActions: [
      {
        type: 'manual_rewrite',
        description: `运行 museflow rewrite ${storyId} -c ${chapterNumber} 重写该章`,
      },
    ],
  }
  await checkpointService.saveBlockingReport(report).catch((err) => {
    logger.warn(`[MuseFlow] 保存阻断报告失败: ${err instanceof Error ? err.message : String(err)}`)
  })
  // 中止 commit 的同时清掉受污染暂存文件，避免恢复对账逻辑日后把它 promote 进来。
  await deleteStagedChapterContent(outputDir, chapterNumber).catch(() => {})
  logger.error(`[MuseFlow] 第 ${chapterNumber} 章 commit 被体例门禁中止：${details}`)
  throw new Error(
    `第 ${chapterNumber} 章在 commit 边界未通过正文体例检查：${details}。已生成阻断报告，请运行 museflow rewrite ${storyId} -c ${chapterNumber} 重写该章。`
  )
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
    await assertStagedChapterHygiene(result, outputDir, checkpointService)
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
