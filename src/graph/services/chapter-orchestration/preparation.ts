import type { ReducedGraphState } from '../../state.js'
import { buildChapterSession, mergeSessionUpdate } from './routing.js'

export async function prepareChapter(
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const currentSession = buildChapterSession(state)
  return mergeSessionUpdate(currentSession, {
    rewriteAttempts: 0,
    errorRewriteAttempts: 0,
    previousIssues: [],
    previousRawErrorCount: 0,
    forceStructuralRewrite: false,
    autoFixAttempts: 0,
    routingDecision: undefined,
    rewriteApproved: false,
  })
}
