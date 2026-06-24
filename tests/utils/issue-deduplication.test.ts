import { describe, expect, it } from 'vitest'
import { deduplicateIssuesSemantically, issueFingerprint } from '../../src/utils/issue-deduplication.js'
import type { Issue } from '../../src/types/agent.js'

describe('issueFingerprint', () => {
  it('produces same fingerprint for rephrased invented-character errors', () => {
    const a: Issue = { id: '1', type: 'hallucination', severity: 'error', description: '苏半城称胞兄为陆廷樑' }
    const b: Issue = { id: '2', type: 'hallucination', severity: 'error', description: '文中出现“胞兄陆廷樑”' }
    expect(issueFingerprint(a)).toBe(issueFingerprint(b))
  })
})

describe('deduplicateIssuesSemantically', () => {
  it('keeps only one error per semantic group', () => {
    const issues: Issue[] = [
      { id: '1', type: 'hallucination', severity: 'error', description: '苏半城称胞兄为陆廷樑' },
      { id: '2', type: 'hallucination', severity: 'error', description: '文中出现“胞兄陆廷樑”' },
      { id: '3', type: 'hallucination', severity: 'error', description: '苏孟祥是 invented 角色' },
    ]
    const deduped = deduplicateIssuesSemantically(issues)
    expect(deduped.length).toBe(2)
  })
})
