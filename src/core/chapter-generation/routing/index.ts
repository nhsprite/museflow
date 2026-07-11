import type { Issue } from '../../../types/agent.js'
import { generateId } from '../../../utils/id.js'
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
import { issueFingerprint } from '../../../utils/issue-deduplication.js'

export * from './types.js'

export interface RoutingDeps {
  issuePolicy: IssuePolicyDeps
  rewritePolicy: RewritePolicyDeps
  fixPolicy: FixPolicyDeps
  isStructuralIssue: (issue: Issue) => Promise<boolean> | boolean
  isLocalIssue: (issue: Issue) => Promise<boolean> | boolean
  isTaskConsistencyIssue: (issue: Issue) => Promise<boolean> | boolean
}

function hasPatchableWarnings(issues: Issue[]): Issue[] {
  return issues.filter((issue) => {
    if (issue.severity !== 'warning') return false
    if (issue.type === 'consistency' && issue.dimension !== 'quality') return true
    if (issue.type === 'consistency' && issue.dimension === 'quality') {
      return (
        issue.locationRef?.paragraphIndex !== undefined ||
        issue.locationRef?.sentenceIndex !== undefined
      )
    }
    return false
  })
}

function allIssuesMatch(
  issues: Issue[],
  predicate: (issue: Issue) => Promise<boolean> | boolean
): Promise<boolean> {
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

  const { issues: processedIssues } = await applyIssuePolicy(ctx.pendingIssues, deps.issuePolicy)

  const structured = ctx.structuredValidationResult
  if (structured) {
    const hasBlocking =
      structured.stateConflicts.length > 0 ||
      structured.falseFulfillments.length > 0 ||
      structured.claimedButUnprovenBeats.length > 0 ||
      structured.missingEvents.length > 0 ||
      structured.unexpectedEvents.length > 0 ||
      structured.eventsMissingEvidence.length > 0 ||
      structured.eventsWithInvalidEvidence.length > 0 ||
      structured.eventsWithInvalidForeshadowDeadline.length > 0
    if (hasBlocking) {
      const chapterIndex = ctx.session.chapterIndex
      const structuredIssues: Issue[] = []
      for (const conflict of structured.stateConflicts) {
        structuredIssues.push({
          id: generateId(),
          type: 'state_conflict',
          severity: 'error',
          description: conflict.description,
          location: `第 ${chapterIndex + 1} 章`,
        })
      }
      for (const beatId of structured.claimedButUnprovenBeats) {
        structuredIssues.push({
          id: generateId(),
          type: 'beat_unproven',
          severity: 'error',
          description: `认领的节拍 ${beatId} 未在正文中找到对应事件`,
          location: `第 ${chapterIndex + 1} 章`,
        })
      }
      for (const fsId of structured.falseFulfillments) {
        structuredIssues.push({
          id: generateId(),
          type: 'foreshadow_false_fulfillment',
          severity: 'error',
          description: `声称兑现的伏笔 ${fsId} 未在正文中发生`,
          location: `第 ${chapterIndex + 1} 章`,
        })
      }
      for (const event of structured.eventsWithInvalidForeshadowDeadline) {
        structuredIssues.push({
          id: generateId(),
          type: 'foreshadow_invalid_deadline',
          severity: 'error',
          description: `伏笔 ${event.foreshadowId} 的预期回收章节 ${String(event.expectedFulfillChapter)} 必须晚于引入章节 ${event.chapterIndex + 1}`,
          location: `第 ${chapterIndex + 1} 章`,
          source: 'foreshadowing',
          retryStrategy: 'draft',
        })
      }
      for (const event of structured.missingEvents) {
        structuredIssues.push({
          id: generateId(),
          type: 'event_missing',
          severity: 'error',
          description: `章节规划要求的结构化事件 ${event.id}（${event.type}）未在正文 STORY_EVENTS 中验证到`,
          location: `第 ${chapterIndex + 1} 章`,
          source: 'outline_compliance',
          retryStrategy: 'draft',
        })
      }
      for (const event of structured.unexpectedEvents) {
        structuredIssues.push({
          id: generateId(),
          type: 'event_unexpected',
          severity: 'error',
          description: `正文 STORY_EVENTS 声明了未由章节规划授权的结构化事件 ${event.id}（${event.type}）`,
          location: `第 ${chapterIndex + 1} 章`,
          source: 'outline_compliance',
          retryStrategy: 'draft',
        })
      }
      for (const event of structured.eventsMissingEvidence) {
        structuredIssues.push({
          id: generateId(),
          type: 'event_evidence_missing',
          severity: 'error',
          description: `结构化事件 ${event.id}（${event.type}）缺少正文段落证据，不能写入 StoryMemory`,
          location: `第 ${chapterIndex + 1} 章`,
          source: 'outline_compliance',
          retryStrategy: 'draft',
        })
      }
      for (const event of structured.eventsWithInvalidEvidence) {
        structuredIssues.push({
          id: generateId(),
          type: 'event_evidence_invalid',
          severity: 'error',
          description: `结构化事件 ${event.id}（${event.type}）引用了不存在的正文段落证据`,
          location: `第 ${chapterIndex + 1} 章`,
          source: 'outline_compliance',
          retryStrategy: 'draft',
        })
      }
      return {
        step: { kind: 'fix' as const, patchableIssues: structuredIssues },
        sessionUpdate: {},
        processedIssues: [...processedIssues, ...structuredIssues],
        newConstraints: [],
      }
    }
  }

  const policyResult = await applyRewritePolicy(session, processedIssues, deps.rewritePolicy)

  const remainingErrors = policyResult.issues.filter((i) => i.severity === 'error')

  const currentErrorFingerprints = await Promise.all(
    remainingErrors.map((issue) => issueFingerprint(undefined, issue))
  )

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

  // Case 1: 重写循环中出现上游状态污染且无法收敛
  if (
    session.rewriteApproved &&
    remainingErrors.length > 0 &&
    (await allIssuesMatch(remainingErrors, deps.rewritePolicy.isStateCorruptionIssue))
  ) {
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
    const patchableWarnings = hasPatchableWarnings(policyResult.issues)

    if (patchableWarnings.length > 0 && session.autoFixAttempts < 3) {
      return {
        step: { kind: 'fix', patchableIssues: patchableWarnings },
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
