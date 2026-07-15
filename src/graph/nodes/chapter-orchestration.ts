import type { ReducedGraphState } from '../state.js'
import type { RuntimeContext } from '../../core/context.js'
import {
  convergeAndDecide,
  routeByDecision,
  routeAfterValidation,
  routeAfterFinalize,
  routeMode,
  prepareChapter,
  requestRewrite,
} from '../services/chapter-orchestration/index.js'

export async function prepare_chapter(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  return prepareChapter(state, context.provider)
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
