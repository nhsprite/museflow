import type { Issue } from '../types/agent.js'
import type { ModelProvider } from '../model/provider.js'
import { batchGenerateIssueFingerprints, generateIssueFingerprint } from './context-judge.js'

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

function isGenericFingerprint(fp: string): boolean {
  return fp === 'unknown:no-subject' || fp === 'unknown:'
}

export async function issueFingerprint(
  provider: ModelProvider | undefined,
  issue: Issue
): Promise<string> {
  const base = generateIssueFingerprint(issue)
  if (!provider || !isGenericFingerprint(base)) {
    return base
  }
  try {
    const results = await batchGenerateIssueFingerprints(provider, [issue])
    const fp = results[0]
    return fp ? `${issue.type}:${fp}` : base
  } catch {
    return base
  }
}

export async function deduplicateIssuesSemantically(
  provider: ModelProvider | undefined,
  issues: Issue[]
): Promise<Issue[]> {
  if (issues.length === 0) {
    return []
  }

  const fingerprints = issues.map((issue) => generateIssueFingerprint(issue))

  if (provider) {
    const genericIndices = fingerprints
      .map((fp, i) => (isGenericFingerprint(fp) ? i : -1))
      .filter((i) => i >= 0)
    if (genericIndices.length > 0) {
      try {
        const genericIssues = genericIndices.map((i) => issues[i]!)
        const llmFingerprints = await batchGenerateIssueFingerprints(provider, genericIssues)
        for (let j = 0; j < genericIndices.length; j++) {
          const fp = llmFingerprints[j]
          const idx = genericIndices[j]!
          if (fp) {
            fingerprints[idx] = `${issues[idx]!.type}:${fp}`
          }
        }
      } catch {
        // Keep rule-based fingerprints on LLM failure.
      }
    }
  }

  const seen = new Map<string, Issue>()
  const result: Issue[] = []
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i]!
    const fp = fingerprints[i]!
    if (!seen.has(fp)) {
      seen.set(fp, issue)
      result.push(issue)
    }
  }
  return result
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
