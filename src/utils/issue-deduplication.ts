import type { Issue } from '../types/agent.js'
import type { ModelProvider } from '../model/provider.js'
import { batchGenerateIssueFingerprints } from './context-judge.js'

export function ruleBasedFingerprint(issue: Issue): string {
  return [
    issue.type,
    issue.severity,
    issue.dimension ?? '',
    issue.source ?? '',
    issue.retryStrategy ?? '',
    formatLocationRef(issue),
  ].join('|')
}

function formatLocationRef(issue: Issue): string {
  const ref = issue.locationRef
  if (!ref) return ''
  return `p=${ref.paragraphIndex ?? ''};s=${ref.sentenceIndex ?? ''}`
}

export async function issueFingerprint(
  provider: ModelProvider | undefined,
  issue: Issue
): Promise<string> {
  if (!provider) {
    return ruleBasedFingerprint(issue)
  }
  try {
    const results = await batchGenerateIssueFingerprints(provider, [issue])
    const fp = results[0] ?? ruleBasedFingerprint(issue)
    return `${issue.type}:${fp}`
  } catch {
    return ruleBasedFingerprint(issue)
  }
}

export async function deduplicateIssuesSemantically(
  provider: ModelProvider | undefined,
  issues: Issue[]
): Promise<Issue[]> {
  if (issues.length === 0) {
    return []
  }
  if (!provider) {
    return deduplicateByRule(issues)
  }

  try {
    const fingerprints = await batchGenerateIssueFingerprints(provider, issues)
    const seen = new Map<string, Issue>()
    const result: Issue[] = []
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i]!
      const fp = fingerprints[i] ?? ruleBasedFingerprint(issue)
      const key = `${issue.type}:${fp}`
      if (!seen.has(key)) {
        seen.set(key, issue)
        result.push(issue)
      }
    }
    return result
  } catch {
    return deduplicateByRule(issues)
  }
}

export function deduplicateByRule(issues: Issue[]): Issue[] {
  const seen = new Map<string, Issue>()
  const result: Issue[] = []
  for (const issue of issues) {
    const key = ruleBasedFingerprint(issue)
    if (!seen.has(key)) {
      seen.set(key, issue)
      result.push(issue)
    }
  }
  return result
}
