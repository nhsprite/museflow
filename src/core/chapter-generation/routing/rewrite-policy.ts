import type { Issue } from '../../../types/agent.js'
import type { RewritePolicyDeps, RewritePolicyResult, ChapterSession } from './types.js'
import { ruleBasedFingerprint } from '../../../utils/issue-deduplication.js'

function buildConstraintFromIssue(issue: Issue): string {
  return `[${issue.type}] ${issue.description}${
    issue.location ? `（位置：${issue.location}）` : ''
  }${issue.suggestion ? `；修复方向：${issue.suggestion}` : ''}`
}

export async function buildVerifiedConstraints(
  previousIssues: Issue[],
  currentIssues: Issue[],
  isInterpretiveIssue: (issue: Issue) => Promise<boolean> | boolean,
  maxConstraints: number,
  log?: (level: 'info' | 'warn' | 'error', message: string, ...meta: unknown[]) => void
): Promise<{ constraints: string[]; resolvedCount: number }> {
  const resolvedIssues: Issue[] = []
  for (const prev of previousIssues) {
    if (prev.severity !== 'error') continue
    if (await isInterpretiveIssue(prev)) continue
    const prevFingerprint = ruleBasedFingerprint(prev)
    const stillPresent = currentIssues.some(
      curr => ruleBasedFingerprint(curr) === prevFingerprint
    )
    if (!stillPresent) {
      resolvedIssues.push(prev)
    }
  }

  const newConstraints = resolvedIssues.map(buildConstraintFromIssue)

  if (newConstraints.length > 0) {
    log?.('info', `[MuseFlow] 本轮已解决 ${resolvedIssues.length} 个问题，已记录为后续规划约束`)
    for (const constraint of newConstraints) {
      log?.(
        'info',
        `  ✓ ${constraint.substring(0, 120)}${constraint.length > 120 ? '...' : ''}`
      )
    }
  }

  const constraints =
    newConstraints.length > maxConstraints
      ? newConstraints.slice(Math.max(0, newConstraints.length - maxConstraints))
      : newConstraints

  return { constraints, resolvedCount: resolvedIssues.length }
}

export async function applyRewritePolicy(
  session: ChapterSession,
  pendingIssues: Issue[],
  deps: RewritePolicyDeps
): Promise<RewritePolicyResult> {
  const config = deps.planningConfig
  const currentErrors = pendingIssues.filter(i => i.severity === 'error')
  const previousErrors = session.previousIssues.filter(i => i.severity === 'error')

  const similarity = await deps.calculateIssueSetSimilarity(previousErrors, currentErrors)
  const errorCountIncreased = currentErrors.length > session.previousRawErrorCount
  const issuesHighlySimilar =
    similarity >= config.issueSetSimilarityThreshold && currentErrors.length > 0

  const hasStateCorruptionError = await Promise.all(
    currentErrors.map(i => deps.isStateCorruptionIssue(i))
  ).then(results => results.some(Boolean))

  let forceStructuralRewrite = session.forceStructuralRewrite

  if (session.errorRewriteAttempts > 1) {
    if (errorCountIncreased) {
      deps.log?.(
        'info',
        `[MuseFlow] 检测到问题数量上升（${session.previousRawErrorCount} -> ${currentErrors.length}），修复未收敛，下次尝试将强制完整重写...`
      )
      forceStructuralRewrite = true
    } else if (issuesHighlySimilar) {
      deps.log?.(
        'info',
        `[MuseFlow] 检测到问题高度重复（相似度 ${Math.round(similarity * 100)}%），修复未收敛，将保留全部问题反馈并强制完整重写...`
      )
      forceStructuralRewrite = true
    }
  }

  let finalIssues = pendingIssues

  const onlyInterpretiveErrors =
    currentErrors.length > 0 &&
    (await Promise.all(currentErrors.map(i => deps.isInterpretiveIssue(i))).then(results =>
      results.every(Boolean)
    ))

  if (
    !forceStructuralRewrite &&
    config.downgradeInterpretiveErrors &&
    onlyInterpretiveErrors &&
    session.errorRewriteAttempts >= config.maxErrorRewriteAttempts - 1
  ) {
    deps.log?.(
      'info',
      `[MuseFlow] 剩余 ${currentErrors.length} 个问题均为解释性一致性问题，自动降级为 warning 以完成本章...`
    )
    finalIssues = pendingIssues.map(issue => {
      if (issue.severity === 'error' && currentErrors.includes(issue)) {
        return { ...issue, severity: 'warning' as const }
      }
      return issue
    })
  }

  const { constraints: newConstraints } = await buildVerifiedConstraints(
    session.previousIssues,
    finalIssues,
    deps.isInterpretiveIssue,
    config.maxVerifiedConstraints,
    deps.log
  )

  return {
    issues: finalIssues,
    forceStructuralRewrite,
    errorCountIncreased,
    issuesHighlySimilar,
    hasStateCorruptionError,
    newConstraints,
  }
}
