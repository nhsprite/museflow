import type { Issue, IssueSeverity } from '../../types/agent.js'

/**
 * Routing decision produced by the rewrite policy.
 *
 * - draft_chapter: discard current plan (or chapter file) and regenerate.
 * - fix_chapter: keep the plan/chapter and apply targeted paragraph/sentence fixes.
 * - finalize_chapter: accept the current chapter.
 * - request_rewrite: stop the loop and ask the user for a full rewrite.
 */
export type RoutingDecision =
  | 'draft_chapter'
  | 'fix_chapter'
  | 'finalize_chapter'
  | 'request_rewrite'
  // Internal routing signal used by the graph node after convergence analysis.
  | 'decide_strategy'

export interface IssueSetSnapshot {
  issues: Issue[]
  rawErrorCount: number
  errorRewriteAttempts: number
}

/**
 * A strategy profile captures the intent of a rewrite pass. It is independent of
 * LangGraph state shape and can be unit tested in isolation.
 */
export interface RewriteStrategy {
  decision: RoutingDecision
  /** Whether the current chapter plan should be discarded and regenerated. */
  discardPlan: boolean
  /** Issues that should be fed back to the chosen agent (draft or fix). */
  feedbackIssues: Issue[]
  /** Whether a rewrite loop should be considered approved after this decision. */
  rewriteApproved: boolean
}

/**
 * Configurable knobs for rewrite routing. Values are intentionally permissive
 * by default so that local unit tests do not need a GenreSkill.
 */
export interface RewriteRoutingConfig {
  /** Maximum number of error-driven rewrite passes before escalating. */
  maxErrorRewriteAttempts: number
  /** Max non-error issues to keep per issue type during convergence. */
  maxNonErrorIssuesPerType: number
  /** Max resolved constraints to carry forward as planning context. */
  maxVerifiedConstraints: number
  /**
   * Similarity threshold (0..1) above which two consecutive error sets are
   * considered non-converging.
   */
  issueSetSimilarityThreshold: number
  /** Whether interpretive consistency errors should be downgraded on the last pass. */
  downgradeInterpretiveErrors: boolean
}

export const DEFAULT_REWRITE_ROUTING_CONFIG: Required<RewriteRoutingConfig> = {
  maxErrorRewriteAttempts: 3,
  maxNonErrorIssuesPerType: 3,
  maxVerifiedConstraints: 20,
  issueSetSimilarityThreshold: 0.5,
  downgradeInterpretiveErrors: true,
}

/**
 * Services the policy may depend on. Keeping them behind an interface makes
 * the policy testable without mocking the whole graph or filesystem.
 */
export interface RewritePolicyServices {
  /** Classify an issue as structural (plan-level). */
  isStructuralIssue(issue: Issue): boolean
  /** Classify an issue as local (paragraph/sentence-level). */
  isLocalIssue(issue: Issue): boolean
  /** Classify an issue as cross-chapter task consistency. */
  isTaskConsistencyIssue(issue: Issue): boolean
  /** Classify an issue as upstream state corruption that should not be auto-fixed. */
  isStateCorruptionIssue(issue: Issue): boolean
  /** Deduplicate issues semantically before convergence analysis. */
  deduplicateIssues(issues: Issue[]): Issue[]
  /** Return a stable fingerprint for an issue, used for set similarity. */
  issueFingerprint(issue: Issue): string
  /** Detect whether an issue is "interpretive" and safe to downgrade. */
  isInterpretiveIssue(issue: Issue): boolean
  /**
   * Determine whether the current chapter outline needs a temporary replan.
   * The default implementation always returns false; callers may inject
   * outline-boundary logic.
   */
  shouldForceTemporaryReplan(): boolean
  /** Read the current chapter content from storage. */
  readChapterContent(): Promise<string | null>
  /** Logger sink for policy decisions. */
  log(level: 'info' | 'warn' | 'error', message: string, ...meta: unknown[]): void
}

export interface RewriteRoutingPolicy {
  /**
   * Decide the next rewrite strategy from the current validation state.
   * Does not mutate the graph state; returns a pure strategy profile.
   */
  decideStrategy(input: {
    chapterIndex: number
    rewriteApproved: boolean
    rewriteAttempts: number
    errorRewriteAttempts: number
    forceStructuralRewrite: boolean
    pendingIssues: Issue[]
    chapterPlanExists: boolean
    config: RewriteRoutingConfig
    services: RewritePolicyServices
  }): Promise<RewriteStrategy>

  /**
   * Evaluate whether the rewrite loop is converging and what to do next.
   * Returns the routing decision plus any post-processing (deduplication,
   * downgrade, verified constraints).
   */
  convergenceCheck(input: {
    rewriteApproved: boolean
    errorRewriteAttempts: number
    previousIssues: Issue[]
    previousRawErrorCount: number
    pendingIssues: Issue[]
    verifiedConstraints: string[]
    config: RewriteRoutingConfig
    services: RewritePolicyServices
  }): ConvergenceResult
}

export interface ConvergenceResult {
  decision: RoutingDecision
  rewriteApproved: boolean
  pendingIssues: Issue[]
  verifiedConstraints: string[]
  /** Whether the next pass should force a structural rewrite. */
  forceStructuralRewrite: boolean
}

export interface InterpretiveDowngradeResult {
  issues: Issue[]
  downgraded: boolean
}

function withSeverity(issue: Issue, severity: IssueSeverity): Issue {
  return { ...issue, severity }
}

export function capNonErrorIssuesByType(
  issues: Issue[],
  maxPerType: number,
  log: RewritePolicyServices['log']
): Issue[] {
  const groups = new Map<string, Issue[]>()
  for (const issue of issues) {
    const list = groups.get(issue.type) ?? []
    list.push(issue)
    groups.set(issue.type, list)
  }

  const result: Issue[] = []
  for (const [type, list] of groups) {
    const errors = list.filter(i => i.severity === 'error')
    const nonErrors = list.filter(i => i.severity !== 'error')
    result.push(...errors)
    if (nonErrors.length <= maxPerType) {
      result.push(...nonErrors)
    } else {
      log(
        'warn',
        `[MuseFlow] 检测到 ${type} 类型有 ${nonErrors.length} 个非错误问题，只保留前 ${maxPerType} 个`
      )
      result.push(...nonErrors.slice(0, maxPerType))
    }
  }
  return result
}

export function calculateIssueSetSimilarity(
  prev: Issue[],
  curr: Issue[],
  issueFingerprint: RewritePolicyServices['issueFingerprint']
): number {
  if (prev.length === 0 || curr.length === 0) return 0
  const prevSet = new Set(prev.map(issueFingerprint))
  const currSet = new Set(curr.map(issueFingerprint))
  let intersection = 0
  for (const fp of currSet) {
    if (prevSet.has(fp)) intersection++
  }
  return intersection / Math.max(prevSet.size, currSet.size)
}

export function downgradeInterpretiveErrors(
  issues: Issue[],
  isInterpretiveIssue: RewritePolicyServices['isInterpretiveIssue']
): InterpretiveDowngradeResult {
  let downgraded = false
  const result = issues.map(issue => {
    if (issue.severity === 'error' && isInterpretiveIssue(issue)) {
      downgraded = true
      return withSeverity(issue, 'warning')
    }
    return issue
  })
  return { issues: result, downgraded }
}

export function buildVerifiedConstraints(
  previousIssues: Issue[],
  currentIssues: Issue[],
  isInterpretiveIssue: RewritePolicyServices['isInterpretiveIssue'],
  maxConstraints: number,
  log: RewritePolicyServices['log']
): { constraints: string[]; resolvedCount: number } {
  const resolvedIssues = previousIssues.filter(
    prev =>
      prev.severity === 'error' &&
      !isInterpretiveIssue(prev) &&
      !currentIssues.some(
        curr => curr.type === prev.type && curr.description === prev.description
      )
  )

  const newConstraints = resolvedIssues.map(
    issue =>
      `[${issue.type}] ${issue.description}${
        issue.location ? `（位置：${issue.location}）` : ''
      }${issue.suggestion ? `；修复方向：${issue.suggestion}` : ''}`
  )

  if (newConstraints.length > 0) {
    log('info', `[MuseFlow] 本轮已解决 ${resolvedIssues.length} 个问题，已记录为后续规划约束`)
    for (const constraint of newConstraints) {
      log(
        'info',
        `  ✓ ${constraint.substring(0, 120)}${constraint.length > 120 ? '...' : ''}`
      )
    }
  }

  let constraints = newConstraints
  if (newConstraints.length > maxConstraints) {
    constraints = newConstraints.slice(
      Math.max(0, newConstraints.length - maxConstraints)
    )
    log(
      'warn',
      `[MuseFlow] verifiedConstraints 超过 ${maxConstraints} 条，已保留最近 ${maxConstraints} 条`
    )
  }

  return { constraints, resolvedCount: resolvedIssues.length }
}

export class DefaultRewriteRoutingPolicy implements RewriteRoutingPolicy {
  async decideStrategy(input: {
    chapterIndex: number
    rewriteApproved: boolean
    rewriteAttempts: number
    errorRewriteAttempts: number
    forceStructuralRewrite: boolean
    pendingIssues: Issue[]
    chapterPlanExists: boolean
    config: RewriteRoutingConfig
    services: RewritePolicyServices
  }): Promise<RewriteStrategy> {
    const {
      chapterIndex,
      rewriteApproved,
      pendingIssues,
      services,
    } = input

    const errorIssues = pendingIssues.filter(i => i.severity === 'error')

    if (
      rewriteApproved &&
      errorIssues.length > 0 &&
      errorIssues.every(services.isStateCorruptionIssue)
    ) {
      services.log(
        'warn',
        '[MuseFlow] 剩余错误均为上游状态污染，停止重写循环，请求人工处理...'
      )
      return {
        decision: 'request_rewrite',
        discardPlan: false,
        feedbackIssues: errorIssues,
        rewriteApproved: false,
      }
    }

    if (errorIssues.length === 0 && !rewriteApproved) {
      const existingContent = await services.readChapterContent()
      if (existingContent !== null && existingContent.trim().length > 0) {
        return {
          decision: 'finalize_chapter',
          discardPlan: false,
          feedbackIssues: [],
          rewriteApproved: false,
        }
      }
    }

    let discardPlan = false
    let decision: Extract<RoutingDecision, 'draft_chapter' | 'fix_chapter'> = 'draft_chapter'
    let feedbackIssues = errorIssues

    if (!rewriteApproved) {
      decision = 'draft_chapter'
      feedbackIssues = []
    } else {
      const chapterFileExists = (await services.readChapterContent()) !== null

      if (!chapterFileExists) {
        services.log(
          'info',
          `[MuseFlow] 第 ${chapterIndex + 1} 章文件不存在，跳过修复模式，直接重新起草...`
        )
        decision = 'draft_chapter'
        feedbackIssues = errorIssues
      } else {
        const hasStructural =
          errorIssues.some(services.isStructuralIssue) || input.forceStructuralRewrite
        const hasLocal = errorIssues.some(services.isLocalIssue)
        const hasTaskConsistency = errorIssues.some(services.isTaskConsistencyIssue)

        if (hasTaskConsistency) {
          services.log(
            'info',
            '[MuseFlow] 检测到跨章节差事一致性错误，将清空计划并重新规划...'
          )
          discardPlan = true
          feedbackIssues = errorIssues
          decision = 'draft_chapter'
        } else if (hasStructural && !hasLocal) {
          services.log(
            'info',
            '[MuseFlow] 检测到结构性问题，将重新规划并完整重写本章...'
          )
          discardPlan = true
          feedbackIssues = errorIssues
          decision = 'draft_chapter'
        } else if (!hasStructural && hasLocal) {
          services.log('info', '[MuseFlow] 检测到局部问题，将使用段落修复模式...')
          decision = 'fix_chapter'
          feedbackIssues = errorIssues
        } else if (hasStructural) {
          services.log(
            'info',
            '[MuseFlow] 同时存在结构性和局部问题，将重新规划并完整重写...'
          )
          discardPlan = true
          feedbackIssues = errorIssues
          decision = 'draft_chapter'
        } else {
          services.log(
            'info',
            '[MuseFlow] 检测到局部问题，将使用现有计划重写...'
          )
          decision = 'draft_chapter'
          feedbackIssues = errorIssues
        }
      }
    }

    return {
      decision,
      discardPlan,
      feedbackIssues,
      rewriteApproved: true,
    }
  }

  convergenceCheck(input: {
    rewriteApproved: boolean
    errorRewriteAttempts: number
    previousIssues: Issue[]
    previousRawErrorCount: number
    pendingIssues: Issue[]
    verifiedConstraints: string[]
    config: RewriteRoutingConfig
    services: RewritePolicyServices
  }): ConvergenceResult {
    const {
      rewriteApproved,
      errorRewriteAttempts,
      previousIssues,
      previousRawErrorCount,
      pendingIssues,
      verifiedConstraints,
      config,
      services,
    } = input

    let dedupedIssues = services.deduplicateIssues(pendingIssues)
    dedupedIssues = capNonErrorIssuesByType(
      dedupedIssues,
      config.maxNonErrorIssuesPerType,
      services.log
    )

    const currentRawErrorCount = dedupedIssues.filter(
      i => i.severity === 'error'
    ).length
    const currentErrorIssues = dedupedIssues.filter(i => i.severity === 'error')
    const previousErrors = previousIssues.filter(i => i.severity === 'error')
    const similarity = calculateIssueSetSimilarity(
      previousErrors,
      currentErrorIssues,
      services.issueFingerprint
    )

    let forceStructuralRewrite = false
    const currentRemainingErrors = dedupedIssues.filter(i => i.severity === 'error')
    const onlyInterpretiveErrors =
      currentRemainingErrors.length > 0 &&
      currentRemainingErrors.every(services.isInterpretiveIssue)

    const errorCountIncreased = currentRawErrorCount > previousRawErrorCount
    const issuesHighlySimilar =
      similarity >= config.issueSetSimilarityThreshold && currentRawErrorCount > 0

    if (errorRewriteAttempts > 1) {
      if (errorCountIncreased) {
        services.log(
          'info',
          `[MuseFlow] 检测到问题数量上升（${previousRawErrorCount} -> ${currentRawErrorCount}），修复未收敛，下次尝试将强制完整重写...`
        )
        forceStructuralRewrite = true
      } else if (issuesHighlySimilar) {
        services.log(
          'info',
          `[MuseFlow] 检测到问题高度重复（相似度 ${Math.round(
            similarity * 100
          )}%），修复未收敛，将保留全部问题反馈并强制完整重写...`
        )
        forceStructuralRewrite = true
      }
    }

    if (
      !forceStructuralRewrite &&
      config.downgradeInterpretiveErrors &&
      onlyInterpretiveErrors &&
      errorRewriteAttempts >= config.maxErrorRewriteAttempts - 1
    ) {
      services.log(
        'info',
        `[MuseFlow] 剩余 ${currentRemainingErrors.length} 个问题均为解释性一致性问题，自动降级为 warning 以完成本章...`
      )
      const downgrade = downgradeInterpretiveErrors(
        dedupedIssues,
        services.isInterpretiveIssue
      )
      dedupedIssues = downgrade.issues
    }

    const { constraints: newConstraints } = buildVerifiedConstraints(
      previousIssues,
      dedupedIssues,
      services.isInterpretiveIssue,
      config.maxVerifiedConstraints,
      services.log
    )

    const updatedConstraints = [...verifiedConstraints, ...newConstraints]
    const trimmedConstraints =
      updatedConstraints.length > config.maxVerifiedConstraints
        ? updatedConstraints.slice(-config.maxVerifiedConstraints)
        : updatedConstraints

    const remainingErrors = dedupedIssues.filter(i => i.severity === 'error')
    let decision: RoutingDecision
    let nextRewriteApproved = rewriteApproved

    if (remainingErrors.length === 0) {
      decision = 'finalize_chapter'
      nextRewriteApproved = false
    } else if (errorRewriteAttempts >= config.maxErrorRewriteAttempts) {
      const corruptionCount = remainingErrors.filter(services.isStateCorruptionIssue).length
      if (corruptionCount > 0) {
        services.log(
          'error',
          `[MuseFlow] 连续 ${config.maxErrorRewriteAttempts} 次重写后仍有 ${remainingErrors.length} 个错误，其中 ${corruptionCount} 个为上游状态污染问题，停止循环。`
        )
      }
      decision = 'request_rewrite'
      nextRewriteApproved = false
    } else {
      decision = 'decide_strategy'
      nextRewriteApproved = true
    }

    return {
      decision,
      rewriteApproved: nextRewriteApproved,
      pendingIssues: dedupedIssues,
      verifiedConstraints: trimmedConstraints,
      forceStructuralRewrite,
    }
  }
}

export function createDefaultRewriteRoutingPolicy(): DefaultRewriteRoutingPolicy {
  return new DefaultRewriteRoutingPolicy()
}
