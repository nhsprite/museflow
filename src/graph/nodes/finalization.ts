import { finalizeChapter, finalizeStory } from '../services/finalization/index.js'
import type { ReducedGraphState } from '../state.js'
import type { RuntimeContext } from '../../core/context.js'

export async function finalize_chapter(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  return finalizeChapter(state, context.provider)
}

export async function finalize_story(
  _context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  return finalizeStory(state)
}
