import type { Issue } from '../../../types/agent.js'
import type { IssuePolicyDeps, IssuePolicyResult } from './types.js'
import { deduplicateByRule, ruleBasedFingerprint } from '../../../utils/issue-deduplication.js'

export async function calculateIssueSetSimilarity(
  prev: Issue[],
  curr: Issue[],
  issueFingerprint?: (issue: Issue) => Promise<string>
): Promise<number> {
  if (prev.length === 0 || curr.length === 0) return 0

  const fingerprintFn = issueFingerprint ?? (async (issue) => ruleBasedFingerprint(issue))

  const prevFps = await Promise.all(prev.map(fingerprintFn))
  const currFps = await Promise.all(curr.map(fingerprintFn))
  const prevSet = new Set(prevFps)
  const currSet = new Set(currFps)

  let intersection = 0
  for (const fp of currSet) {
    if (prevSet.has(fp)) intersection++
  }
  return intersection / Math.max(prevSet.size, currSet.size)
}

export function capNonErrorIssuesByType(
  issues: Issue[],
  maxPerType: number,
  log?: (level: 'info' | 'warn' | 'error', message: string, ...meta: unknown[]) => void
): { result: Issue[]; cappedTypes: string[] } {
  const groups = new Map<string, Issue[]>()
  for (const issue of issues) {
    const list = groups.get(issue.type) ?? []
    list.push(issue)
    groups.set(issue.type, list)
  }

  const result: Issue[] = []
  const cappedTypes: string[] = []

  for (const [type, list] of groups) {
    const errors = list.filter((i) => i.severity === 'error')
    const nonErrors = list.filter((i) => i.severity !== 'error')
    result.push(...errors)
    if (nonErrors.length <= maxPerType) {
      result.push(...nonErrors)
    } else {
      log?.(
        'warn',
        `[MuseFlow] 检测到 ${type} 类型有 ${nonErrors.length} 个非错误问题，只保留前 ${maxPerType} 个`
      )
      result.push(...nonErrors.slice(0, maxPerType))
      cappedTypes.push(type)
    }
  }

  return { result, cappedTypes }
}

export async function applyIssuePolicy(
  issues: Issue[],
  deps: IssuePolicyDeps
): Promise<IssuePolicyResult> {
  let processed = [...issues]
  let downgraded = false

  if (deps.deduplicateIssues) {
    processed = await deps.deduplicateIssues(processed)
  } else {
    // 默认使用规则去重，防止同一问题在多次校验后被重复累积。
    processed = deduplicateByRule(processed)
  }

  const maxPerType = deps.planningConfig.maxNonErrorIssuesPerType
  const { result: capped, cappedTypes } = capNonErrorIssuesByType(processed, maxPerType, deps.log)

  return {
    issues: capped,
    downgraded,
    cappedTypes,
  }
}
