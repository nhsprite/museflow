import { describe, expect, it, vi } from 'vitest'
import {
  deduplicateIssuesSemantically,
  issueFingerprint,
  ruleBasedFingerprint,
} from '../../src/utils/issue-deduplication.js'
import { generateIssueFingerprint } from '../../src/utils/context-judge.js'
import type { Issue } from '../../src/types/agent.js'
import type { ModelProvider } from '../../src/model/provider.js'

function createMockProvider(response: string | string[]): ModelProvider {
  return {
    chat: vi
      .fn()
      .mockResolvedValue(
        typeof response === 'string'
          ? JSON.stringify({ results: [response] })
          : JSON.stringify({ results: response })
      ),
  }
}

describe('ruleBasedFingerprint', () => {
  it('uses structured fields rather than rephrased descriptions', () => {
    const a: Issue = {
      id: '1',
      type: 'hallucination',
      severity: 'error',
      description: '角色乙不在官方角色列表',
    }
    const b: Issue = {
      id: '2',
      type: 'hallucination',
      severity: 'error',
      description: '角色乙不在官方角色列表中',
    }
    expect(ruleBasedFingerprint(a)).toBe(ruleBasedFingerprint(b))
  })

  it('produces different fingerprints for different structured locations', () => {
    const a: Issue = {
      id: '1',
      type: 'hallucination',
      severity: 'error',
      description: '角色甲不在官方列表',
      locationRef: { paragraphIndex: 0 },
    }
    const b: Issue = {
      id: '2',
      type: 'hallucination',
      severity: 'error',
      description: '角色乙不在官方列表',
      locationRef: { paragraphIndex: 1 },
    }
    expect(ruleBasedFingerprint(a)).not.toBe(ruleBasedFingerprint(b))
  })

  it('ignores natural-language location strings', () => {
    const a: Issue = {
      id: '1',
      type: 'hallucination',
      severity: 'error',
      description: '角色甲不在官方列表',
      location: '第1段',
    }
    const b: Issue = {
      id: '2',
      type: 'hallucination',
      severity: 'error',
      description: '角色乙不在官方列表',
      location: '第2段',
    }
    expect(ruleBasedFingerprint(a)).toBe(ruleBasedFingerprint(b))
  })

  it('ignores numbers in descriptions', () => {
    const a: Issue = {
      id: '1',
      type: 'quality',
      severity: 'warning',
      description: '第12章字数不足',
    }
    const b: Issue = { id: '2', type: 'quality', severity: 'warning', description: '第3章字数不足' }
    expect(ruleBasedFingerprint(a)).toBe(ruleBasedFingerprint(b))
  })

  it('does not extract quoted natural-language entities', () => {
    const a: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: '「长命锁」不应出现在当铺',
    }
    const b: Issue = {
      id: '2',
      type: 'consistency',
      severity: 'error',
      description: '“长命锁”不应出现在当铺',
    }
    expect(ruleBasedFingerprint(a)).toBe(ruleBasedFingerprint(b))
  })
})

describe('issueFingerprint with provider', () => {
  it('prefers generateIssueFingerprint over LLM result', async () => {
    const issue: Issue = {
      id: '1',
      type: 'hallucination',
      severity: 'error',
      description: '角色甲不在官方列表',
    }
    const provider = createMockProvider('llm-fingerprint')
    const fp = await issueFingerprint(provider, issue)
    expect(fp).toBe(generateIssueFingerprint(issue))
  })

  it('falls back to LLM fingerprint when rule fingerprint is generic', async () => {
    const issue: Issue = {
      id: '1',
      type: 'hallucination',
      severity: 'error',
      description: '',
    }
    const provider = createMockProvider('llm-fingerprint')
    const fp = await issueFingerprint(provider, issue)
    expect(fp).toBe('hallucination:llm-fingerprint')
  })

  it('falls back to generateIssueFingerprint when provider is undefined', async () => {
    const issue: Issue = {
      id: '1',
      type: 'hallucination',
      severity: 'error',
      description: '角色甲不在官方列表',
    }
    const fp = await issueFingerprint(undefined, issue)
    expect(fp).toBe(generateIssueFingerprint(issue))
  })
})

describe('deduplicateIssuesSemantically', () => {
  it('deduplicates by generateIssueFingerprint without provider', async () => {
    const issues: Issue[] = [
      {
        id: '1',
        type: 'hallucination',
        severity: 'error',
        description: '角色乙不在官方角色列表',
        locationRef: { paragraphIndex: 0 },
        dimension: 'character',
        subject: 'unofficial-character',
      },
      {
        id: '2',
        type: 'hallucination',
        severity: 'error',
        description: '角色乙不在官方角色列表中',
        locationRef: { paragraphIndex: 0 },
        dimension: 'character',
        subject: 'unofficial-character',
      },
      {
        id: '3',
        type: 'hallucination',
        severity: 'error',
        description: '角色丙不在官方角色列表',
        locationRef: { paragraphIndex: 1 },
        dimension: 'character',
        subject: 'unofficial-character-c',
      },
    ]
    const deduped = await deduplicateIssuesSemantically(undefined, issues)
    expect(deduped.length).toBe(2)
  })

  it('keeps distinct structured locations separate with rule-based fallback', async () => {
    const issues: Issue[] = [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '物品甲同时出现在仓库和书房',
        locationRef: { paragraphIndex: 0 },
      },
      {
        id: '2',
        type: 'consistency',
        severity: 'error',
        description: '角色甲在城东却于同一时刻现身城西',
        locationRef: { paragraphIndex: 1 },
      },
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
