import { finalizeChapter, finalizeStory } from '../services/finalization/index.js'
import type { ReducedGraphState } from '../state.js'
import type { RuntimeContext } from '../../core/context.js'
import { readChapterContentForRun } from '../../storage/filesystem/writer.js'
import { isNarrativeAuditCurrent } from '../services/narrative-audit/index.js'
import { ChapterValidationError } from '../../utils/chapter-validation-error.js'

export async function finalize_chapter(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const content = await readChapterContentForRun(
    state.story.outputDir,
    state.currentChapterIndex + 1
  )
  if (content?.trim() && !(await isNarrativeAuditCurrent(state, content))) {
    throw new ChapterValidationError(
      'narrative.audit',
      state.currentChapterIndex,
      '审计凭证缺失或正文/记录已变化，需重新检查'
    )
  }
  const result = await finalizeChapter(state, context.provider)
  if (!result.chapterReport || !context.telemetry) return result
  return {
    ...result,
    chapterReport: {
      ...result.chapterReport,
      modelUsage: context.telemetry.summarizeChapter(state.currentChapterIndex),
    },
  }
}

export async function finalize_story(
  _context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  return finalizeStory(state)
}
