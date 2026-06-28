import type { Issue } from '../types/agent.js'
import type { ModelProvider } from '../model/provider.js'
import { batchGenerateIssueFingerprints } from './context-judge.js'

export async function issueFingerprint(
  provider: ModelProvider | undefined,
  issue: Issue
): Promise<string> {
  if (!provider) {
    return fallbackFingerprint(issue)
  }
  const results = await batchGenerateIssueFingerprints(provider, [issue])
  const fp = results[0] ?? fallbackFingerprint(issue)
  return `${issue.type}:${fp}`
}

export async function deduplicateIssuesSemantically(
  provider: ModelProvider | undefined,
  issues: Issue[]
): Promise<Issue[]> {
  if (!provider || issues.length === 0) {
    return [...issues]
  }
  const fingerprints = await batchGenerateIssueFingerprints(provider, issues)
  const seen = new Map<string, Issue>()
  const result: Issue[] = []
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i]!
    const fp = fingerprints[i] ?? fallbackFingerprint(issue)
    const key = `${issue.type}:${fp}`
    if (!seen.has(key)) {
      seen.set(key, issue)
      result.push(issue)
    }
  }
  return result
}

function fallbackFingerprint(issue: Issue): string {
  return `${issue.description ?? ''}:${issue.location ?? ''}`
}
