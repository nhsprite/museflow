import type { ReducedGraphState } from '../../graph/state.js'
import { expandOutlineForChapter } from '../outline-expander.js'

export interface DraftFixNodeFunctions {
  draft_chapter: (state: ReducedGraphState) => Promise<Partial<ReducedGraphState>>
  fix_chapter: (state: ReducedGraphState) => Promise<Partial<ReducedGraphState>>
}

export async function runDraftPhase(
  state: ReducedGraphState,
  nodeFunctions: DraftFixNodeFunctions
): Promise<ReducedGraphState> {
  const { draft_chapter } = nodeFunctions
  const draftResult = await draft_chapter(state)
  return { ...state, ...draftResult, pendingIssues: [] }
}

export async function runFixPhase(
  state: ReducedGraphState,
  nodeFunctions: DraftFixNodeFunctions
): Promise<ReducedGraphState> {
  const { fix_chapter } = nodeFunctions
  if (!state.chapterPlan) {
    const { chapterPlan } = await expandOutlineForChapter(state, state.currentChapterIndex)
    state = { ...state, chapterPlan }
  }
  const fixResult = await fix_chapter(state)
  return { ...state, ...fixResult, pendingIssues: [] }
}
