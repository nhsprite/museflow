import type { ReducedGraphState } from '../../graph/state.js'
import type { Issue } from '../../types/agent.js'
import { deduplicateIssuesSemantically, issueFingerprint } from '../../utils/issue-deduplication.js'
import { isInventedCharacterIssue, isItemLocationConflictIssue } from './issue-classifier.js'
import { getChapterPlanningConfig } from '../../utils/chapter-planning.js'

const INTERPRETIVE_ISSUE_PATTERN = /提前.*(?:剧透|揭示)|看破.*说破|感应.*反应|选择性感应|表达方式|性格驱动/

export function calculateIssueSetSimilarity(prev: Issue[], curr: Issue[]): number {
  if (prev.length === 0 || curr.length === 0) return 0
  const prevSet = new Set(prev.map(issueFingerprint))
  const currSet = new Set(curr.map(issueFingerprint))
  let intersection = 0
  for (const fp of currSet) {
    if (prevSet.has(fp)) intersection++
  }
  return intersection / Math.max(prevSet.size, currSet.size)
}

function capNonErrorIssuesByType(issues: Issue[], maxNonErrorIssuesPerType: number): Issue[] {
  const issueGroups = new Map<string, Issue[]>()
  for (const issue of issues) {
    const list = issueGroups.get(issue.type) ?? []
    list.push(issue)
    issueGroups.set(issue.type, list)
  }

  const dedupedIssues: Issue[] = []
  for (const [type, issues] of issueGroups) {
    const errors = issues.filter(i => i.severity === 'error')
    const nonErrors = issues.filter(i => i.severity !== 'error')
    dedupedIssues.push(...errors)
    if (nonErrors.length <= maxNonErrorIssuesPerType) {
      dedupedIssues.push(...nonErrors)
    } else {
      console.warn(`[MuseFlow] 检测到 ${type} 类型有 ${nonErrors.length} 个非错误问题，只保留前 ${maxNonErrorIssuesPerType} 个`)
      dedupedIssues.push(...nonErrors.slice(0, maxNonErrorIssuesPerType))
    }
  }
  return dedupedIssues
}

function isInterpretiveIssue(issue: Issue): boolean {
  return INTERPRETIVE_ISSUE_PATTERN.test(issue.description) || INTERPRETIVE_ISSUE_PATTERN.test(issue.location || '')
}

function updateVerifiedConstraints(
  previousIssues: Issue[],
  currentIssues: Issue[],
  verifiedConstraints: string[],
  forceReset: boolean,
  maxVerifiedConstraints: number
): { verifiedConstraints: string[]; resolvedCount: number } {
  if (forceReset) {
    return { verifiedConstraints: [], resolvedCount: 0 }
  }

  const resolvedIssues = previousIssues.filter(prev =>
    prev.severity === 'error' &&
    !isInterpretiveIssue(prev) &&
    !currentIssues.some(curr =>
      curr.type === prev.type && curr.description === prev.description
    )
  )

  if (resolvedIssues.length === 0) {
    return { verifiedConstraints, resolvedCount: 0 }
  }

  const newConstraints = resolvedIssues.map(issue =>
    `[${issue.type}] ${issue.description}${issue.location ? `（位置：${issue.location}）` : ''}${issue.suggestion ? `；修复方向：${issue.suggestion}` : ''}`
  )
  let updatedConstraints = [...verifiedConstraints, ...newConstraints]
  if (updatedConstraints.length > maxVerifiedConstraints) {
    updatedConstraints = updatedConstraints.slice(-maxVerifiedConstraints)
    console.warn(`[MuseFlow] verifiedConstraints 超过 ${maxVerifiedConstraints} 条，已保留最近 ${maxVerifiedConstraints} 条`)
  }
  console.log(`[MuseFlow] 本轮已解决 ${resolvedIssues.length} 个问题，已记录为后续规划约束`)
  for (const constraint of newConstraints) {
    console.log(`  ✓ ${constraint.substring(0, 120)}${constraint.length > 120 ? '...' : ''}`)
  }

  return { verifiedConstraints: updatedConstraints, resolvedCount: resolvedIssues.length }
}

function downgradeInterpretiveErrors(issues: Issue[]): Issue[] {
  return issues.map(i =>
    i.severity === 'error' && (INTERPRETIVE_ISSUE_PATTERN.test(i.description) || INTERPRETIVE_ISSUE_PATTERN.test(i.location || ''))
      ? { ...i, severity: 'warning' as const }
      : i
  )
}

export interface ConvergenceResult {
  workingState: ReducedGraphState
  forceStructuralRewrite: boolean
  verifiedConstraints: string[]
}

export function runConvergenceCheck(
  workingState: ReducedGraphState,
  previousIssues: Issue[],
  previousRawErrorCount: number,
  verifiedConstraints: string[],
  rewriteAttempts: number,
  maxRewriteAttempts: number
): ConvergenceResult {
  const planningConfig = getChapterPlanningConfig(workingState.genre)

  let updatedState = { ...workingState, pendingIssues: deduplicateIssuesSemantically(workingState.pendingIssues) }
  updatedState = { ...updatedState, pendingIssues: capNonErrorIssuesByType(updatedState.pendingIssues, planningConfig.maxNonErrorIssuesPerType) }

  const errorCountAfterDedup = updatedState.pendingIssues.filter(i => i.severity === 'error').length
  const currentRawErrorCount = updatedState.pendingIssues.filter(i => i.severity === 'error').length
  const currentErrorIssues = updatedState.pendingIssues.filter(i => i.severity === 'error')
  const similarity = calculateIssueSetSimilarity(previousIssues.filter(i => i.severity === 'error'), currentErrorIssues)

  let forceStructuralRewrite = false

  const currentRemainingErrors = updatedState.pendingIssues.filter(i => i.severity === 'error')
  const onlyInterpretiveErrors = currentRemainingErrors.length > 0 && currentRemainingErrors.every(isInterpretiveIssue)

  if (rewriteAttempts > 1) {
    if (currentRawErrorCount > previousRawErrorCount) {
      console.log(`[MuseFlow] 检测到问题数量上升（${previousRawErrorCount} -> ${currentRawErrorCount}），修复未收敛，下次尝试将强制完整重写...`)
      forceStructuralRewrite = true
    } else if (similarity >= 0.5 && errorCountAfterDedup > 0) {
      console.log(`[MuseFlow] 检测到问题高度重复（相似度 ${Math.round(similarity * 100)}%），修复未收敛，将保留全部问题反馈并强制完整重写...`)
      forceStructuralRewrite = true
      updatedState = { ...updatedState, pendingIssues: updatedState.pendingIssues }
    } else if (onlyInterpretiveErrors && rewriteAttempts >= maxRewriteAttempts - 1) {
      console.log(`[MuseFlow] 剩余 ${currentRemainingErrors.length} 个问题均为解释性一致性问题，自动降级为 warning 以完成本章...`)
      updatedState = {
        ...updatedState,
        pendingIssues: downgradeInterpretiveErrors(updatedState.pendingIssues),
      }
    }
  }

  const constraintsResult = updateVerifiedConstraints(previousIssues, updatedState.pendingIssues, verifiedConstraints, forceStructuralRewrite, planningConfig.maxVerifiedConstraints)
  verifiedConstraints = constraintsResult.verifiedConstraints
  updatedState = { ...updatedState, verifiedConstraints }

  return {
    workingState: updatedState,
    forceStructuralRewrite,
    verifiedConstraints,
  }
}

export function detectStateCorruption(
  remainingErrors: Issue[],
  rewriteAttempts: number,
  maxRewriteAttempts: number
): Issue | null {
  if (rewriteAttempts < maxRewriteAttempts || remainingErrors.length === 0) {
    return null
  }

  const stateCorruptionSignals = remainingErrors.filter(
    i => isInventedCharacterIssue(i) || isItemLocationConflictIssue(i)
  )

  if (stateCorruptionSignals.length / remainingErrors.length >= 0.5) {
    return {
      id: 'state-corruption',
      type: 'state_corruption',
      severity: 'error' as const,
      description: `连续 ${maxRewriteAttempts} 次重写后，剩余错误仍集中于上游状态污染（虚构角色、错误亲属关系或物品位置矛盾）。建议先修复 meta.json / storyState 后再运行 rewrite。`,
    }
  }

  return null
}
