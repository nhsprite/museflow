import { logger } from '../../../utils/logger.js'
import type { ReducedGraphState } from '../../state.js'
import { buildChapterSession } from './routing.js'

export async function requestRewrite(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const errors = state.pendingIssues.filter(i => i.severity === 'error')
  if (errors.length > 0) {
    logger.error('[MuseFlow] 严重问题需要重写:', errors)
  }
  const currentSession = buildChapterSession(state)
  return {
    rewriteRequested: true,
    rewriteApproved: false,
    session: { ...currentSession, routingDecision: undefined },
  }
}
