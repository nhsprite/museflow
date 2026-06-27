import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import { shouldForceTemporaryReplan } from '../../utils/outline-boundary.js'
import { getChapterPlanningConfig } from '../../utils/chapter-planning.js'
import {
  createDefaultRewriteRoutingPolicy,
  DEFAULT_REWRITE_ROUTING_CONFIG,
  type RewriteRoutingConfig,
} from '../policies/rewrite-routing.js'
import { createRewritePolicyServices } from '../policies/default-services.js'

function createPolicyServices(state: ReducedGraphState): import('../policies/rewrite-routing.js').RewritePolicyServices {
  return createRewritePolicyServices(
    state.story.outputDir,
    state.currentChapterIndex + 1,
    state.outline,
    state.currentChapterIndex
  )
}

function buildRoutingConfig(genre: string): Required<RewriteRoutingConfig> {
  const planningConfig = getChapterPlanningConfig(genre)
  return {
    ...DEFAULT_REWRITE_ROUTING_CONFIG,
    maxNonErrorIssuesPerType: planningConfig.maxNonErrorIssuesPerType,
    maxVerifiedConstraints: planningConfig.maxVerifiedConstraints,
  }
}

export async function prepare_chapter(
  _state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  return {
    rewriteAttempts: 0,
    errorRewriteAttempts: 0,
    previousIssues: [],
    previousRawErrorCount: 0,
    forceStructuralRewrite: false,
    autoFixAttempts: 0,
    routingDecision: undefined,
  }
}

export async function decide_strategy(
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const nextAttempts = (state.rewriteAttempts || 0) + 1
  const errorIssues = state.pendingIssues.filter(i => i.severity === 'error')
  const nextErrorAttempts = errorIssues.length > 0
    ? (state.errorRewriteAttempts || 0) + 1
    : (state.errorRewriteAttempts || 0)

  const policy = createDefaultRewriteRoutingPolicy()
  const config = buildRoutingConfig(state.genre)
  const services = createPolicyServices(state)

  const strategy = await policy.decideStrategy({
    chapterIndex: state.currentChapterIndex,
    rewriteApproved: state.rewriteApproved,
    rewriteAttempts: state.rewriteAttempts || 0,
    errorRewriteAttempts: state.errorRewriteAttempts || 0,
    forceStructuralRewrite: state.forceStructuralRewrite || false,
    pendingIssues: state.pendingIssues,
    chapterPlanExists: state.chapterPlan !== null,
    config,
    services,
  })

  let chapterPlan = state.chapterPlan
  if (chapterPlan && shouldForceTemporaryReplan(state.outline, state.currentChapterIndex)) {
    logger.info('[MuseFlow] 检测到跨章节大纲桥接冲突，将临时重新规划本章...')
    chapterPlan = null
  }

  if (strategy.discardPlan) {
    chapterPlan = null
  }

  return {
    rewriteAttempts: nextAttempts,
    errorRewriteAttempts: nextErrorAttempts,
    chapterPlan,
    pendingIssues: strategy.feedbackIssues,
    routingDecision: strategy.decision,
    forceStructuralRewrite: false,
    autoFixAttempts: 0,
  }
}

export function route_strategy(_state: ReducedGraphState): string {
  return _state.routingDecision ?? 'finalize_chapter'
}

export function convergence_check(
  state: ReducedGraphState
): Partial<ReducedGraphState> {
  const policy = createDefaultRewriteRoutingPolicy()
  const config = buildRoutingConfig(state.genre)
  const services = createPolicyServices(state)

  const result = policy.convergenceCheck({
    rewriteApproved: state.rewriteApproved,
    errorRewriteAttempts: state.errorRewriteAttempts || 0,
    previousIssues: state.previousIssues,
    previousRawErrorCount: state.previousRawErrorCount || 0,
    pendingIssues: state.pendingIssues,
    verifiedConstraints: state.verifiedConstraints ?? [],
    config,
    services,
  })

  return {
    pendingIssues: result.pendingIssues,
    verifiedConstraints: result.verifiedConstraints,
    previousIssues: result.pendingIssues,
    previousRawErrorCount: result.pendingIssues.filter(i => i.severity === 'error').length,
    forceStructuralRewrite: result.forceStructuralRewrite,
    rewriteApproved: result.rewriteApproved,
    routingDecision: result.decision,
    autoFixAttempts: 0,
  }
}

export function route_convergence(state: ReducedGraphState): string {
  return state.routingDecision ?? 'finalize_chapter'
}

export function route_after_validation(state: ReducedGraphState): string {
  const errors = state.pendingIssues.filter(i => i.severity === 'error')
  if (errors.length > 0) {
    return 'convergence_check'
  }
  // warning 不再触发自动修复循环，避免质量/风格类 warning 消耗重写次数。
  // 如需处理 warning，可通过独立的 polish 流程或手动 rewrite。
  return 'finalize_chapter'
}

export async function request_rewrite(
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const errors = state.pendingIssues.filter(i => i.severity === 'error')
  if (errors.length > 0) {
    logger.error('[MuseFlow] 严重问题需要重写:', errors)
  }
  return {
    rewriteRequested: true,
    rewriteApproved: false,
    routingDecision: undefined,
  }
}

export function route_after_finalize(state: ReducedGraphState): string {
  if (state.writeOneChapterOnly) {
    return 'finalize_story'
  }
  if (state.currentChapterIndex < state.totalChapters) {
    return 'prepare_chapter'
  }
  return 'finalize_story'
}

export function route_mode(state: ReducedGraphState): string {
  return state.isWriting ? 'prepare_chapter' : 'build_world'
}
