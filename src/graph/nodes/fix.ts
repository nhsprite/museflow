import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import { getFixAgent } from '../agent-factory.js'
import { readChapterContent } from '../../storage/filesystem/writer.js'
import { buildLayeredSummaries } from '../../utils/summary-compressor.js'
import { buildCharacterFactTimeline } from '../utils/reconciler/index.js'
import { buildNextChapterBoundaryHint } from '../../utils/outline-boundary.js'
import { splitIntoParagraphs, findAffectedParagraphs } from '../utils/text-patching.js'
import {
  hasPatchableIssues,
  determineFixMode,
  buildSentenceFixes,
  runSentenceFix,
  runParagraphFix,
  runLegacyFix,
} from '../services/fix/index.js'
import type { RuntimeContext } from '../../core/context.js'

export async function fix_chapter(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const agent = getFixAgent(context.provider)
  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]

  const existingContent = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  if (!existingContent) {
    throw new Error(`第 ${chapterIndex + 1} 章文件不存在，无法修复。请运行 write 或 rewrite。`)
  }

  const pendingIssues = state.pendingIssues
  if (!hasPatchableIssues(pendingIssues)) {
    logger.info('[MuseFlow] 当前警告不适合段落/句子级修复，跳过 fix agent')
    return { chapters: state.chapters }
  }

  const paragraphs = splitIntoParagraphs(existingContent)
  const affectedIndices = findAffectedParagraphs(paragraphs, pendingIssues)

  const previousChapters = buildLayeredSummaries(state.chapterSummaries, chapterIndex)
  const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)
  const nextBoundaryHint = buildNextChapterBoundaryHint(state.outline, chapterIndex)

  const decision = determineFixMode(paragraphs, affectedIndices, pendingIssues)

  if (decision.mode === 'legacy') {
    logger.info(`[MuseFlow] ${decision.reason}`)
    return await runLegacyFix(
      agent,
      context.provider,
      state,
      existingContent,
      chapterIndex,
      outlineItem,
      previousChapters,
      timelineSnapshot,
      nextBoundaryHint
    )
  }

  const sentenceFixes = buildSentenceFixes(paragraphs, affectedIndices, pendingIssues)

  if (sentenceFixes.length > 0 && sentenceFixes.length <= 5) {
    logger.info(`[MuseFlow] 定位到 ${sentenceFixes.length} 个需修改的句子，使用句子级精准修复`)
    return await runSentenceFix(
      agent,
      context.provider,
      state,
      existingContent,
      paragraphs,
      sentenceFixes,
      chapterIndex,
      outlineItem,
      previousChapters,
      timelineSnapshot,
      nextBoundaryHint
    )
  }

  logger.info(`[MuseFlow] ${decision.reason}`)
  return await runParagraphFix(
    agent,
    context.provider,
    state,
    existingContent,
    paragraphs,
    affectedIndices,
    chapterIndex,
    outlineItem,
    previousChapters,
    timelineSnapshot,
    nextBoundaryHint
  )
}

export { runLegacyFix } from '../services/fix/index.js'
