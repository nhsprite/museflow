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

export * from './types.js'
export { applyIssuePolicy, capNonErrorIssuesByType, calculateIssueSetSimilarity } from './issue-policy.js'
export { applyRewritePolicy, buildVerifiedConstraints } from './rewrite-policy.js'
export { classifyIssues, decideRepairApproach } from './fix-policy.js'

export interface RoutingDeps {
  issuePolicy: IssuePolicyDeps
  rewritePolicy: RewritePolicyDeps
  fixPolicy: FixPolicyDeps
  isStructuralIssue: (issue: Issue) => Promise<boolean> | boolean
  isLocalIssue: (issue: Issue) => Promise<boolean> | boolean
  isTaskConsistencyIssue: (issue: Issue) => Promise<boolean> | boolean
}

function hasPatchableWarnings(issues: Issue[]): Issue[] {
  return issues.filter(issue => {
    if (issue.severity !== 'warning') return false
    if (issue.type === 'consistency' && issue.dimension !== 'quality') return true
    if (issue.type === 'consistency' && issue.dimension === 'quality' && issue.location) {
      return /第\s*\d+\s*[段节]|段落\s*\d+|第\s*\d+\s*句/.test(issue.location)
    }
    return false
  })
}

function allIssuesMatch(
  issues: Issue[],
  predicate: (issue: Issue) => Promise<boolean> | boolean
): Promise<boolean> {
  if (issues.length === 0) return Promise.resolve(false)
  return Promise.all(issues.map(predicate)).then(results => results.every(Boolean))
}

export async function decideNextStep(
  ctx: RoutingContext,
  deps: RoutingDeps
): Promise<RoutingResult> {
  const session = ctx.session
  const config = deps.issuePolicy.planningConfig

  const { issues: processedIssues } = await applyIssuePolicy(ctx.pendingIssues, deps.issuePolicy)

  const policyResult = await applyRewritePolicy(session, processedIssues, deps.rewritePolicy)

  const remainingErrors = policyResult.issues.filter(i => i.severity === 'error')

  // Case 1: 重写循环中出现上游状态污染且无法收敛
  if (
    session.rewriteApproved &&
    remainingErrors.length > 0 &&
    (await allIssuesMatch(remainingErrors, deps.rewritePolicy.isStateCorruptionIssue))
  ) {
    return {
      step: {
        kind: 'request_rewrite',
        reason: '剩余错误均为上游状态污染，需要人工处理',
        blockingIssues: remainingErrors,
      },
      sessionUpdate: { rewriteApproved: false },
      processedIssues: policyResult.issues,
      newConstraints: policyResult.newConstraints,
    }
  }

  // Case 2: 无剩余错误
  if (remainingErrors.length === 0) {
    const patchableWarnings = hasPatchableWarnings(policyResult.issues)

    if (patchableWarnings.length > 0 && session.autoFixAttempts < 3) {
      return {
        step: { kind: 'fix', patchableIssues: patchableWarnings },
        sessionUpdate: { autoFixAttempts: session.autoFixAttempts + 1 },
        processedIssues: policyResult.issues,
        newConstraints: policyResult.newConstraints,
      }
    }

    if (!session.rewriteApproved) {
      return {
        step: ctx.chapterFileExists ? { kind: 'finalize' } : { kind: 'draft', discardPlan: false, feedbackIssues: [] },
        sessionUpdate: { rewriteApproved: false },
        processedIssues: policyResult.issues,
        newConstraints: policyResult.newConstraints,
      }
    }

    if (session.rewriteAttempts === 0) {
      return {
        step: { kind: 'draft', discardPlan: false, feedbackIssues: [] },
        sessionUpdate: { rewriteApproved: true },
        processedIssues: policyResult.issues,
        newConstraints: policyResult.newConstraints,
      }
    }

    return {
      step: { kind: 'finalize' },
      sessionUpdate: { rewriteApproved: false },
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
        reason: `连续 ${config.maxErrorRewriteAttempts} 次重写后仍未解决所有错误`,
        blockingIssues: remainingErrors,
      },
      sessionUpdate: { rewriteApproved: false },
      processedIssues: policyResult.issues,
      newConstraints: policyResult.newConstraints,
    }
  }

  // Case 4: 需要继续修复，决定 draft 还是 fix
  const summary = await classifyIssues(
    remainingErrors,
    deps.isStructuralIssue,
    deps.isLocalIssue,
    deps.isTaskConsistencyIssue
  )

  const approach = decideRepairApproach(
    session,
    summary,
    ctx.chapterFileExists,
    deps.fixPolicy.log
  )

  if (approach.kind === 'fix') {
    return {
      step: { kind: 'fix', patchableIssues: remainingErrors },
      sessionUpdate: {
        errorRewriteAttempts: session.errorRewriteAttempts + 1,
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
    },
    processedIssues: policyResult.issues,
    newConstraints: policyResult.newConstraints,
  }
}
