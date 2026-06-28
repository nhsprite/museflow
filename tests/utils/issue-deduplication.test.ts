import { describe, expect, it, vi } from 'vitest'
import { deduplicateIssuesSemantically, issueFingerprint } from '../../src/utils/issue-deduplication.js'
import type { Issue } from '../../src/types/agent.js'
import type { ModelProvider } from '../../src/model/provider.js'

function createMockProvider(response: string | string[]): ModelProvider {
  return {
    chat: vi.fn().mockResolvedValue(
      typeof response === 'string'
        ? JSON.stringify({ results: [response] })
        : JSON.stringify({ results: response })
    ),
  }
}

describe('issueFingerprint', () => {
  it('produces same fingerprint for rephrased invented-character errors', async () => {
    const a: Issue = { id: '1', type: 'hallucination', severity: 'error', description: '苏半城称胞兄为陆廷樑' }
    const b: Issue = { id: '2', type: 'hallucination', severity: 'error', description: '文中出现“胞兄陆廷樑”' }
    const provider = createMockProvider(['invented-character-brother-陆廷樑', 'invented-character-brother-陆廷樑'])
    const fpA = await issueFingerprint(provider, a)
    const fpB = await issueFingerprint(provider, b)
    expect(fpA).toBe(fpB)
  })
})

describe('deduplicateIssuesSemantically', () => {
  it('keeps only one error per semantic group', async () => {
    const issues: Issue[] = [
      { id: '1', type: 'hallucination', severity: 'error', description: '苏半城称胞兄为陆廷樑' },
      { id: '2', type: 'hallucination', severity: 'error', description: '文中出现“胞兄陆廷樑”' },
      { id: '3', type: 'hallucination', severity: 'error', description: '苏孟祥是 invented 角色' },
    ]
    const provider = createMockProvider([
      'invented-character-brother-陆廷樑',
      'invented-character-brother-陆廷樑',
      'invented-character-苏孟祥',
    ])
    const deduped = await deduplicateIssuesSemantically(provider, issues)
    expect(deduped.length).toBe(2)
  })
})
