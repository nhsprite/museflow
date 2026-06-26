import type { ReducedGraphState } from '../../graph/state.js'
import type { buildNovelGraph } from '../../graph/novel.graph.js'
import type { getCheckpointer } from '../../graph/checkpointer.js'
import { generateId } from '../../utils/id.js'

export type GraphInstance = ReturnType<typeof buildNovelGraph>
export type CheckpointerInstance = ReturnType<typeof getCheckpointer>

export interface GraphUpdatePatch {
  rewriteApproved: boolean
  rewriteRequested: boolean
  pendingIssues: ReducedGraphState['pendingIssues']
  currentChapterIndex: number
  chapters: ReducedGraphState['chapters']
  chapterSummaries: ReducedGraphState['chapterSummaries']
  storyState: ReducedGraphState['storyState']
  verifiedConstraints: ReducedGraphState['verifiedConstraints']
}

function buildPatch(
  workingState: ReducedGraphState,
  flags: { rewriteApproved: boolean; rewriteRequested: boolean }
): GraphUpdatePatch {
  return {
    rewriteApproved: flags.rewriteApproved,
    rewriteRequested: flags.rewriteRequested,
    pendingIssues: workingState.pendingIssues,
    currentChapterIndex: workingState.currentChapterIndex,
    chapters: workingState.chapters,
    chapterSummaries: workingState.chapterSummaries,
    storyState: workingState.storyState,
    verifiedConstraints: workingState.verifiedConstraints,
  }
}

export async function persistBrokenState(
  graph: GraphInstance,
  storyId: string,
  outputDir: string,
  workingState: ReducedGraphState
): Promise<void> {
  await graph.updateState(
    { configurable: { thread_id: storyId, outputDir } },
    buildPatch(workingState, { rewriteApproved: false, rewriteRequested: true })
  )
}

export async function persistSuccessState(
  graph: GraphInstance,
  storyId: string,
  outputDir: string,
  workingState: ReducedGraphState
): Promise<void> {
  await graph.updateState(
    { configurable: { thread_id: storyId, outputDir } },
    buildPatch(workingState, { rewriteApproved: false, rewriteRequested: false })
  )
}

export async function persistFailureState(
  graph: GraphInstance,
  storyId: string,
  outputDir: string,
  workingState: ReducedGraphState,
  errorMessage: string
): Promise<void> {
  const draftIssue = {
    id: generateId(),
    type: 'draft_failure' as const,
    severity: 'error' as const,
    description: errorMessage,
  }

  await graph.updateState(
    { configurable: { thread_id: storyId, outputDir } },
    {
      ...buildPatch(workingState, { rewriteApproved: false, rewriteRequested: true }),
      pendingIssues: [...workingState.pendingIssues, draftIssue],
    }
  )
}

export async function saveChapterCheckpoint(
  checkpointer: CheckpointerInstance,
  outputDir: string,
  chapterNumber: number
): Promise<void> {
  await checkpointer.saveChapterCheckpoint(outputDir, chapterNumber)
}
