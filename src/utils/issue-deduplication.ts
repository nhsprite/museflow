import type { Issue } from '../types/agent.js'
import { generateIssueFingerprint } from './context-judge.js'

export function deduplicateByRule(issues: Issue[]): Issue[] {
  const seen = new Map<string, Issue>()
  const result: Issue[] = []
  for (const issue of issues) {
    // severity 参与去重键：同一指纹的 error 与 warning 不得折叠，
    // 避免 warning 在前时把未解决的 error 静默丢弃。
    // 无 subject 且无结构化位置的指纹已含 description 哈希，
    // 不同措辞的泛化问题不会被跨条合并。
    const key = `${issue.severity}:${generateIssueFingerprint(issue)}`
    if (!seen.has(key)) {
      seen.set(key, issue)
      result.push(issue)
    }
  }
  return result
}
