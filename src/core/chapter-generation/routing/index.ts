import type { Issue } from '../../../types/agent.js'
import type {
  FixPolicyDeps,
  IssuePolicyDeps,
  RewritePolicyDeps,
  RoutingContext,
  RoutingResult,
} from './types.js'
import { applyIssuePolicy } from './issue-policy.js'
import { applyRewritePolicy } from './rewrite-policy.js'
import { classifyIssues, decideRepairApproach } from './fix-policy.js'
import { generateIssueFingerprint } from '../../../utils/context-judge.js'
import { hasPatchableIssues } from '../../../graph/services/fix/decision.js'
import {
  buildStructuredIssues,
  replaceStructuredIssues,
  STRUCTURED_ISSUE_TYPES,
} from './structured-issues.js'

export * from './types.js'

export interface RoutingDeps {
  issuePolicy: IssuePolicyDeps
  rewritePolicy: RewritePolicyDeps
  fixPolicy: FixPolicyDeps
  isStructuralIssue: (issue: Issue) => boolean
  isLocalIssue: (issue: Issue) => boolean
  isTaskConsistencyIssue: (issue: Issue) => boolean
  /** 用于停滞检测的 issue 指纹函数；未提供时使用规则指纹。 */
  fingerprintIssue?: (issue: Issue) => Promise<string> | string
}

function allIssuesMatch(issues: Issue[], predicate: (issue: Issue) => boolean): Promise<boolean> {
  if (issues.length === 0) return Promise.resolve(false)
  return Promise.all(issues.map(predicate)).then((results) => results.every(Boolean))
}

function calculateFingerprintSetSimilarity(prev: string[], curr: string[]): number {
  if (prev.length === 0 || curr.length === 0) return 0
  const prevSet = new Set(prev)
  const currSet = new Set(curr)
  let intersection = 0
  for (const fp of currSet) {
    if (prevSet.has(fp)) intersection++
  }
  return intersection / Math.max(prevSet.size, currSet.size)
}

function isRewriteLoopStalled(
  history: string[][],
  currentFingerprints: string[],
  threshold = 0.7,
  minRounds = 3
): boolean {
  if (currentFingerprints.length === 0) return false
  const fullHistory = [...history, currentFingerprints]
  if (fullHistory.length < minRounds) return false

  const recentRounds = fullHistory.slice(-minRounds)
  for (let i = 1; i < recentRounds.length; i++) {
    const similarity = calculateFingerprintSetSimilarity(recentRounds[i - 1]!, recentRounds[i]!)
    if (similarity < threshold) return false
  }
  return true
}

function decideStrategyFromRetryStrategies(errors: Issue[]): 'draft' | 'fix' | 'manual' {
  if (errors.length === 0) return 'draft'
  if (errors.some((e) => e.retryStrategy === 'manual')) return 'manual'
  if (errors.every((e) => e.retryStrategy === 'fix')) return 'fix'
  return 'draft'
}

export async function decideNextStep(
  ctx: RoutingContext,
  deps: RoutingDeps
): Promise<RoutingResult> {
  const session = ctx.session
  const config = deps.issuePolicy.planningConfig

  const freshStructuredIssues = buildStructuredIssues(
    ctx.structuredValidationResult,
    ctx.session.chapterIndex
  )
  const currentIssues = ctx.structuredValidationResult
    ? replaceStructuredIssues(ctx.pendingIssues, freshStructuredIssues)
    : ctx.pendingIssues
  const { issues: processedIssues } = await applyIssuePolicy(currentIssues, deps.issuePolicy)

  const policyResult = await applyRewritePolicy(session, processedIssues, deps.rewritePolicy)

  const remainingErrors = policyResult.issues.filter((i) => i.severity === 'error')

  const fingerprintIssue =
    deps.fingerprintIssue ?? ((issue: Issue) => generateIssueFingerprint(issue))
  const currentErrorFingerprints = await Promise.all(remainingErrors.map(fingerprintIssue))

  const nextFingerprintHistory = [...session.issueFingerprintHistory, currentErrorFingerprints]

  // 停滞检测：连续多轮问题指纹高度相似，说明 rewrite 循环无法收敛
  if (
    remainingErrors.length > 0 &&
    session.rewriteApproved &&
    isRewriteLoopStalled(session.issueFingerprintHistory, currentErrorFingerprints)
  ) {
    deps.rewritePolicy.log?.(
      'error',
      `[MuseFlow] 检测到重写循环停滞，连续多轮问题集合高度相似，停止循环并请求人工处理。`
    )
    return {
      step: {
        kind: 'request_rewrite',
        reason: 'rewrite_loop_stalled' as const,
        blockingIssues: remainingErrors,
      },
      sessionUpdate: {
        rewriteApproved: false,
        issueFingerprintHistory: nextFingerprintHistory,
      },
      processedIssues: policyResult.issues,
      newConstraints: policyResult.newConstraints,
    }
  }

  // Case 1: 重写循环中出现上游状态污染且无法收敛。
  // 本章尚未尝试过状态修复时，先走 repair_state 自动修复路径；
  // 已尝试过（修复失败或修后仍报同类错）则退回人工 request_rewrite。
  if (
    session.rewriteApproved &&
    remainingErrors.length > 0 &&
    (await allIssuesMatch(remainingErrors, deps.rewritePolicy.isStateCorruptionIssue))
  ) {
    if (!session.stateRepairAttempted) {
      return {
        step: { kind: 'repair_state' },
        sessionUpdate: {
          stateRepairAttempted: true,
          issueFingerprintHistory: nextFingerprintHistory,
        },
        processedIssues: policyResult.issues,
        newConstraints: policyResult.newConstraints,
      }
    }
    return {
      step: {
        kind: 'request_rewrite',
        reason: 'state_corruption' as const,
        blockingIssues: remainingErrors,
      },
      sessionUpdate: {
        rewriteApproved: false,
        issueFingerprintHistory: nextFingerprintHistory,
      },
      processedIssues: policyResult.issues,
      newConstraints: policyResult.newConstraints,
    }
  }

  // Case 2: 无剩余错误
  if (remainingErrors.length === 0) {
    const patchable = hasPatchableIssues(policyResult.issues)

    if (patchable && session.autoFixAttempts < 3) {
      return {
        step: { kind: 'fix', patchableIssues: policyResult.issues },
        sessionUpdate: {
          autoFixAttempts: session.autoFixAttempts + 1,
          issueFingerprintHistory: nextFingerprintHistory,
        },
        processedIssues: policyResult.issues,
        newConstraints: policyResult.newConstraints,
      }
    }

    if (!session.rewriteApproved) {
      return {
        step: ctx.chapterFileExists
          ? { kind: 'finalize' }
          : { kind: 'draft', discardPlan: false, feedbackIssues: [] },
        sessionUpdate: {
          rewriteApproved: false,
          issueFingerprintHistory: nextFingerprintHistory,
        },
        processedIssues: policyResult.issues,
        newConstraints: policyResult.newConstraints,
      }
    }

    if (session.rewriteAttempts === 0) {
      return {
        step: { kind: 'draft', discardPlan: false, feedbackIssues: [] },
        sessionUpdate: {
          rewriteApproved: true,
          issueFingerprintHistory: nextFingerprintHistory,
        },
        processedIssues: policyResult.issues,
        newConstraints: policyResult.newConstraints,
      }
    }

    return {
      step: { kind: 'finalize' },
      sessionUpdate: {
        rewriteApproved: false,
        issueFingerprintHistory: nextFingerprintHistory,
      },
      processedIssues: policyResult.issues,
      newConstraints: policyResult.newConstraints,
    }
  }

  // Case 3: 超过最大错误重写次数
  if (session.errorRewriteAttempts >= config.maxErrorRewriteAttempts) {
    if (policyResult.hasStateCorruptionError) {
      deps.rewritePolicy.log?.(
        'error',
        `[MuseFlow] 连续 ${config.maxErrorRewriteAttempts} 次重写后仍有 ${remainingErrors.length} 个错误，其中包含上游状态污染问题，停止循环。`
      )
    }
    return {
      step: {
        kind: 'request_rewrite',
        reason: 'max_rewrite_attempts' as const,
        blockingIssues: remainingErrors,
      },
      sessionUpdate: {
        rewriteApproved: false,
        issueFingerprintHistory: nextFingerprintHistory,
      },
      processedIssues: policyResult.issues,
      newConstraints: policyResult.newConstraints,
    }
  }

  // Case 4: 需要继续修复，决定 draft 还是 fix
  const retryStrategy = decideStrategyFromRetryStrategies(remainingErrors)

  if (!ctx.chapterFileExists) {
    return {
      step: { kind: 'draft', discardPlan: false, feedbackIssues: remainingErrors },
      sessionUpdate: {
        errorRewriteAttempts: session.errorRewriteAttempts + 1,
        issueFingerprintHistory: nextFingerprintHistory,
      },
      processedIssues: policyResult.issues,
      newConstraints: policyResult.newConstraints,
    }
  }

  if (retryStrategy === 'manual') {
    return {
      step: {
        kind: 'request_rewrite',
        reason: 'state_corruption' as const,
        blockingIssues: remainingErrors,
      },
      sessionUpdate: {
        rewriteApproved: false,
        issueFingerprintHistory: nextFingerprintHistory,
      },
      processedIssues: policyResult.issues,
      newConstraints: policyResult.newConstraints,
    }
  }

  if (retryStrategy === 'fix') {
    return {
      step: { kind: 'fix', patchableIssues: remainingErrors },
      sessionUpdate: {
        errorRewriteAttempts: session.errorRewriteAttempts + 1,
        issueFingerprintHistory: nextFingerprintHistory,
      },
      processedIssues: policyResult.issues,
      newConstraints: policyResult.newConstraints,
    }
  }

  if (remainingErrors.some((issue) => STRUCTURED_ISSUE_TYPES.has(issue.type))) {
    return {
      step: { kind: 'draft', discardPlan: false, feedbackIssues: remainingErrors },
      sessionUpdate: {
        errorRewriteAttempts: session.errorRewriteAttempts + 1,
        issueFingerprintHistory: nextFingerprintHistory,
      },
      processedIssues: policyResult.issues,
      newConstraints: policyResult.newConstraints,
    }
  }

  const summary = await classifyIssues(
    remainingErrors,
    deps.isStructuralIssue,
    deps.isLocalIssue,
    deps.isTaskConsistencyIssue
  )

  const approach = decideRepairApproach(session, summary, ctx.chapterFileExists, deps.fixPolicy.log)

  if (approach.kind === 'fix') {
    return {
      step: { kind: 'fix', patchableIssues: remainingErrors },
      sessionUpdate: {
        errorRewriteAttempts: session.errorRewriteAttempts + 1,
        issueFingerprintHistory: nextFingerprintHistory,
      },
      processedIssues: policyResult.issues,
      newConstraints: policyResult.newConstraints,
    }
  }

  return {
    step: { kind: 'draft', discardPlan: approach.discardPlan, feedbackIssues: remainingErrors },
    sessionUpdate: {
      errorRewriteAttempts: session.errorRewriteAttempts + 1,
      forceStructuralRewrite: policyResult.forceStructuralRewrite || approach.discardPlan,
      issueFingerprintHistory: nextFingerprintHistory,
    },
    processedIssues: policyResult.issues,
    newConstraints: policyResult.newConstraints,
  }
}
