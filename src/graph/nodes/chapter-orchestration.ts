import type { ReducedGraphState } from '../state.js'
import type { Issue } from '../../types/agent.js'
import type { RuntimeContext } from '../../core/context.js'
import {
  convergeAndDecide,
  routeByDecision,
  routeAfterValidation,
  routeAfterFinalize,
  routeMode,
  prepareChapter,
  requestRewrite,
  downgradeInterpretiveErrors as downgradeInterpretiveErrorsImpl,
  capNonErrorIssuesByType,
} from '../services/chapter-orchestration/index.js'

export type {
  RoutingDecision,
  RewriteRoutingConfig,
  RewriteConvergenceResult,
  InterpretiveDowngradeResult,
} from '../services/chapter-orchestration/types.js'
export { DEFAULT_REWRITE_ROUTING_CONFIG } from '../services/chapter-orchestration/types.js'

export { capNonErrorIssuesByType }

export {
  calculateIssueSetSimilarity,
  buildVerifiedConstraints,
} from '../services/chapter-orchestration/routing.js'

export async function downgradeInterpretiveErrors(
  issues: Issue[],
  isInterpretiveIssue: (issue: Issue) => Promise<boolean>
): Promise<{ issues: Issue[]; downgraded: boolean }> {
  return downgradeInterpretiveErrorsImpl(issues, isInterpretiveIssue)
}

export async function prepare_chapter(
  _context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  return prepareChapter(state)
}

export async function converge_and_decide(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  return convergeAndDecide(state, context)
}

export function route_by_decision(state: ReducedGraphState): string {
  return routeByDecision(state)
}

export function route_after_validation(_state: ReducedGraphState): string {
  return routeAfterValidation(_state)
}

export async function request_rewrite(
  _context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  return requestRewrite(state)
}

export function route_after_finalize(state: ReducedGraphState): string {
  return routeAfterFinalize(state)
}

export function route_mode(state: ReducedGraphState): string {
  return routeMode(state)
}
