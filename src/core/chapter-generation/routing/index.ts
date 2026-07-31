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
import { findPersistentBeatUnprovenBeatIds } from './beat-claim-revocation.js'
import {
  buildBeatClaimOutlineRejection,
  MAX_OUTLINE_REGEN_ATTEMPTS,
} from './outline-regeneration.js'
import { calculateFingerprintSetSimilarity, isFingerprintSubset } from './fingerprint.js'

export * from './types.js'
export * from './outline-regeneration.js'

export interface RoutingDeps {
  issuePolicy: IssuePolicyDeps
  rewritePolicy: RewritePolicyDeps
  fixPolicy: FixPolicyDeps
  /** 用于停滞检测的 issue 指纹函数；未提供时使用规则指纹。 */
  fingerprintIssue?: (issue: Issue) => Promise<string> | string
}

function isRewriteLoopStalled(
  history: string[][],
  currentFingerprints: string[],
  threshold: number,
  minRounds: number
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

function isRewriteLoopSubsetStalled(
  history: string[][],
  currentFingerprints: string[],
  minRounds: number
): boolean {
  if (currentFingerprints.length === 0) return false
  const fullHistory = [...history, currentFingerprints]
  if (fullHistory.length < minRounds) return false

  const recentRounds = fullHistory.slice(-minRounds)
  for (let i = 1; i < recentRounds.length; i++) {
    if (!isFingerprintSubset(recentRounds[i - 1]!, recentRounds[i]!)) return false
  }
  return true
}

function decideStrategyFromRetryStrategies(errors: Issue[]): 'draft' | 'fix' | 'manual' {
  if (errors.length === 0) return 'draft'
  if (errors.some((e) => e.retryStrategy === 'manual')) return 'manual'
  if (errors.every((e) => e.retryStrategy === 'fix')) return 'fix'
  return 'draft'
}

function requiresForeshadowReplan(issues: readonly Issue[]): boolean {
  return issues.some((issue) => issue.type === 'foreshadow_false_fulfillment')
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

  // 停滞检测：连续多轮问题指纹高度相似，或连续两轮当前错误集是上一轮子集，
  // 说明 rewrite 循环无法收敛
  if (
    remainingErrors.length > 0 &&
    session.rewriteApproved &&
    (isRewriteLoopStalled(
      session.issueFingerprintHistory,
      currentErrorFingerprints,
      config.rewriteStallSimilarityThreshold,
      config.rewriteStallMinRounds
    ) ||
      isRewriteLoopSubsetStalled(
        session.issueFingerprintHistory,
        currentErrorFingerprints,
        config.rewriteStallMinRounds
      ))
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

  // Case 1: 重写循环中出现上游状态污染。
  // 只要剩余 error 中至少有一个是状态污染类问题，就优先尝试自动状态修复；
  // 尝试次数由题材配置控制，耗尽后退回人工 request_rewrite。
  const hasStateCorruptionError = await Promise.all(
    remainingErrors.map((i) => deps.rewritePolicy.isStateCorruptionIssue(i))
  ).then((results) => results.some(Boolean))

  if (session.rewriteApproved && remainingErrors.length > 0 && hasStateCorruptionError) {
    const stateRepairAttempts = session.stateRepairAttempts ?? 0
    if (stateRepairAttempts < config.maxStateRepairAttempts) {
      return {
        step: { kind: 'repair_state' },
        sessionUpdate: {
          stateRepairAttempts: stateRepairAttempts + 1,
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

    if (patchable && session.autoFixAttempts < config.maxAutoFixAttempts) {
      return {
        step: { kind: 'fix_chapter', patchableIssues: policyResult.issues },
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
          ? { kind: 'finalize_chapter' }
          : { kind: 'draft_chapter', discardPlan: false, feedbackIssues: [] },
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
        step: { kind: 'draft_chapter', discardPlan: false, feedbackIssues: [] },
        sessionUpdate: {
          rewriteApproved: true,
          issueFingerprintHistory: nextFingerprintHistory,
        },
        processedIssues: policyResult.issues,
        newConstraints: policyResult.newConstraints,
      }
    }

    return {
      step: { kind: 'finalize_chapter' },
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
    const discardPlan = requiresForeshadowReplan(remainingErrors)
    return {
      step: { kind: 'draft_chapter', discardPlan, feedbackIssues: remainingErrors },
      sessionUpdate: {
        errorRewriteAttempts: session.errorRewriteAttempts + 1,
        forceStructuralRewrite: policyResult.forceStructuralRewrite || discardPlan,
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
      step: { kind: 'fix_chapter', patchableIssues: remainingErrors },
      sessionUpdate: {
        errorRewriteAttempts: session.errorRewriteAttempts + 1,
        issueFingerprintHistory: nextFingerprintHistory,
      },
      processedIssues: policyResult.issues,
      newConstraints: policyResult.newConstraints,
    }
  }

  if (remainingErrors.some((issue) => STRUCTURED_ISSUE_TYPES.has(issue.type))) {
    // 同一节拍连续两轮未被正文证实，判定为大纲层虚假认领：撤销认领并弃置 plan 重建，
    // 而不是继续用同一份带毒认领重起草正文。
    const revokedBeatClaimIds = findPersistentBeatUnprovenBeatIds(
      session.previousIssues,
      remainingErrors
    )

    // 幕边界高压下不允许撤销 mandatory beat 认领：撤销只是换了一条「本章零消费」的
    // 放行路径，幕末必然以更高代价阻塞。但连续未证实暴露的可能是大纲层的实现缺陷
    // （description 只写了节拍的外围仪式，正文无论如何起草都无法证明），此时先把
    // 正文驳回反馈回流到大纲生成层重生成大纲（保留强制认领约束，次数有上限）；
    // 重生成耗尽后才判本章写作失败，转人工处置（重试本章、adjust-act 延长本幕，
    // 或人工修订大纲）。
    const revokedMandatoryBeatIds = ctx.mandatoryBeatHighPressure
      ? revokedBeatClaimIds.filter((id) => ctx.unprovenMandatoryBeatIds?.includes(id))
      : []
    if (revokedMandatoryBeatIds.length > 0) {
      const outlineRegenAttempts = session.outlineRegenAttempts ?? 0
      if (outlineRegenAttempts < MAX_OUTLINE_REGEN_ATTEMPTS) {
        const beatClaimOutlineRejection = buildBeatClaimOutlineRejection({
          beatIds: revokedMandatoryBeatIds,
          issues: remainingErrors,
          storyArc: ctx.storyArc,
          outline: ctx.outline,
          chapterIndex: session.chapterIndex,
          pendingMandatoryBeatIds: ctx.unprovenMandatoryBeatIds ?? [],
        })
        deps.rewritePolicy.log?.(
          'warn',
          `[MuseFlow] 幕边界高压下 mandatory beat ${revokedMandatoryBeatIds.join('、')} 连续未被正文证实，将携带驳回反馈重生成第 ${session.chapterIndex + 1} 章大纲（第 ${outlineRegenAttempts + 1}/${MAX_OUTLINE_REGEN_ATTEMPTS} 次）`
        )
        return {
          step: {
            kind: 'draft_chapter',
            discardPlan: true,
            regenerateOutline: true,
            feedbackIssues: [],
          },
          sessionUpdate: {
            outlineRegenAttempts: outlineRegenAttempts + 1,
            beatClaimOutlineRejection,
            errorRewriteAttempts: session.errorRewriteAttempts + 1,
            forceStructuralRewrite: true,
            // 大纲前提已变，基于旧大纲的停滞指纹不再适用，重置以免误报停滞。
            issueFingerprintHistory: [],
          },
          processedIssues: policyResult.issues,
          newConstraints: policyResult.newConstraints,
        }
      }
      const highPressureIssue: Issue = {
        id: `mandatory-beat-unproven-high-pressure-${session.chapterIndex}`,
        ruleId: 'outline.mandatory-beat-unproven-high-pressure',
        type: 'beat_unproven',
        severity: 'error',
        subject: revokedMandatoryBeatIds.join(', '),
        description: `幕边界高压状态（未消费 mandatory beats 多于幕内剩余章节）下，mandatory beat ${revokedMandatoryBeatIds.join('、')} 连续多轮未被正文证实，不允许撤销认领跳过：本章写作失败。请重新运行本章生成，或运行 adjust-act 延长本幕，或人工修订大纲后再继续。`,
        source: 'outline_compliance',
        retryStrategy: 'draft',
      }
      return {
        step: {
          kind: 'request_rewrite',
          reason: 'mandatory_beat_unproven' as const,
          blockingIssues: [highPressureIssue, ...remainingErrors],
        },
        sessionUpdate: {
          rewriteApproved: false,
          issueFingerprintHistory: nextFingerprintHistory,
        },
        processedIssues: [...policyResult.issues, highPressureIssue],
        newConstraints: policyResult.newConstraints,
      }
    }

    const discardPlan = requiresForeshadowReplan(remainingErrors) || revokedBeatClaimIds.length > 0
    // 被撤销认领的节拍必须把「认领已撤销、不得再声明」的反馈持久化进 processedIssues
    // （会写回 pendingIssues），否则下一轮起草仍收到「请证明该节拍」的旧反馈，
    // 与已摘除认领的大纲相互矛盾，可能诱使正文声明未授权事件。
    const issuesWithFeedback =
      revokedBeatClaimIds.length > 0
        ? policyResult.issues.map((issue) =>
            issue.type === 'beat_unproven' &&
            issue.subject !== undefined &&
            revokedBeatClaimIds.includes(issue.subject)
              ? {
                  ...issue,
                  description: `节拍 ${issue.subject} 的大纲认领已撤销：连续多轮未被正文证实，判定为大纲层错误认领。本章正文与 STORY_EVENTS 均不得再声明推进该节拍。`,
                }
              : issue
          )
        : policyResult.issues
    return {
      step: {
        kind: 'draft_chapter',
        discardPlan,
        feedbackIssues: issuesWithFeedback.filter((issue) => issue.severity === 'error'),
        ...(revokedBeatClaimIds.length > 0 ? { revokedBeatClaimIds } : {}),
      },
      sessionUpdate: {
        errorRewriteAttempts: session.errorRewriteAttempts + 1,
        forceStructuralRewrite: policyResult.forceStructuralRewrite || discardPlan,
        issueFingerprintHistory: nextFingerprintHistory,
      },
      processedIssues: issuesWithFeedback,
      newConstraints: policyResult.newConstraints,
    }
  }

  const summary = await classifyIssues(remainingErrors)

  const approach = decideRepairApproach(session, summary, ctx.chapterFileExists, deps.fixPolicy.log)

  if (approach.kind === 'fix') {
    return {
      step: { kind: 'fix_chapter', patchableIssues: remainingErrors },
      sessionUpdate: {
        errorRewriteAttempts: session.errorRewriteAttempts + 1,
        issueFingerprintHistory: nextFingerprintHistory,
      },
      processedIssues: policyResult.issues,
      newConstraints: policyResult.newConstraints,
    }
  }

  return {
    step: {
      kind: 'draft_chapter',
      discardPlan: approach.discardPlan,
      feedbackIssues: remainingErrors,
    },
    sessionUpdate: {
      errorRewriteAttempts: session.errorRewriteAttempts + 1,
      forceStructuralRewrite: policyResult.forceStructuralRewrite || approach.discardPlan,
      issueFingerprintHistory: nextFingerprintHistory,
    },
    processedIssues: policyResult.issues,
    newConstraints: policyResult.newConstraints,
  }
}
