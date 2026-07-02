import { describe, expect, it, vi } from 'vitest'
import { deduplicateIssuesSemantically, issueFingerprint, ruleBasedFingerprint } from '../../src/utils/issue-deduplication.js'
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

describe('ruleBasedFingerprint', () => {
  it('produces same fingerprint for rephrased invented-character errors', () => {
    const a: Issue = { id: '1', type: 'hallucination', severity: 'error', description: '角色乙不在官方角色列表' }
    const b: Issue = { id: '2', type: 'hallucination', severity: 'error', description: '角色乙不在官方角色列表中' }
    expect(ruleBasedFingerprint(a)).toBe(ruleBasedFingerprint(b))
  })

  it('produces different fingerprints for different core entities', () => {
    const a: Issue = { id: '1', type: 'hallucination', severity: 'error', description: '角色甲不在官方列表' }
    const b: Issue = { id: '2', type: 'hallucination', severity: 'error', description: '角色乙不在官方列表' }
    expect(ruleBasedFingerprint(a)).not.toBe(ruleBasedFingerprint(b))
  })

  it('normalizes numbers in descriptions', () => {
    const a: Issue = { id: '1', type: 'quality', severity: 'warning', description: '第12章字数不足' }
    const b: Issue = { id: '2', type: 'quality', severity: 'warning', description: '第3章字数不足' }
    expect(ruleBasedFingerprint(a)).toBe(ruleBasedFingerprint(b))
  })

  it('extracts Chinese quoted entities', () => {
    const a: Issue = { id: '1', type: 'consistency', severity: 'error', description: '「长命锁」不应出现在当铺' }
    const b: Issue = { id: '2', type: 'consistency', severity: 'error', description: '“长命锁”不应出现在当铺' }
    expect(ruleBasedFingerprint(a)).toBe(ruleBasedFingerprint(b))
  })
})

describe('issueFingerprint with provider', () => {
  it('uses LLM fingerprint when provider returns a result', async () => {
    const issue: Issue = { id: '1', type: 'hallucination', severity: 'error', description: '角色甲不在官方列表' }
    const provider = createMockProvider('llm-fingerprint')
    const fp = await issueFingerprint(provider, issue)
    expect(fp).toBe('hallucination:llm-fingerprint')
  })

  it('falls back to rule-based fingerprint when provider is undefined', async () => {
    const issue: Issue = { id: '1', type: 'hallucination', severity: 'error', description: '角色甲不在官方列表' }
    const fp = await issueFingerprint(undefined, issue)
    expect(fp).toBe(ruleBasedFingerprint(issue))
  })
})

describe('deduplicateIssuesSemantically', () => {
  it('deduplicates rephrased errors using rule-based fallback without provider', async () => {
    const issues: Issue[] = [
      { id: '1', type: 'hallucination', severity: 'error', description: '角色乙不在官方角色列表' },
      { id: '2', type: 'hallucination', severity: 'error', description: '角色乙不在官方角色列表中' },
      { id: '3', type: 'hallucination', severity: 'error', description: '角色丙不在官方角色列表' },
    ]
    const deduped = await deduplicateIssuesSemantically(undefined, issues)
    expect(deduped.length).toBe(2)
  })

  it('keeps distinct errors separate with rule-based fallback', async () => {
    const issues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '物品甲同时出现在仓库和书房' },
      { id: '2', type: 'consistency', severity: 'error', description: '角色甲在城东却于同一时刻现身城西' },
    ]
    const deduped = await deduplicateIssuesSemantically(undefined, issues)
    expect(deduped.length).toBe(2)
  })

  it('uses LLM fingerprints when provider is available', async () => {
    const issues: Issue[] = [
      { id: '1', type: 'hallucination', severity: 'error', description: '角色甲不在官方列表' },
      { id: '2', type: 'hallucination', severity: 'error', description: '角色乙不在官方列表' },
    ]
    const provider = createMockProvider(['fp-a', 'fp-b'])
    const deduped = await deduplicateIssuesSemantically(provider, issues)
    expect(deduped.length).toBe(2)
  })
})
