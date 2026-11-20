import { finalizeChapter, finalizeStory } from '../services/finalization/index.js'
import type { ReducedGraphState } from '../state.js'
import type { RuntimeContext } from '../../core/context.js'

export async function finalize_chapter(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
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
