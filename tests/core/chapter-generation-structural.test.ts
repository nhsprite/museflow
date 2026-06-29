import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as contextJudge from '../../src/utils/context-judge.js'
import { isStructuralIssue } from '../../src/core/chapter-generation/issue-classifier.js'
import type { Issue } from '../../src/types/agent.js'
import type { ModelProvider } from '../../src/model/provider.js'

vi.mock('../../src/utils/context-judge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof contextJudge>()
  return {
    ...actual,
    batchClassifyIssues: vi.fn(),
  }
})

function createProvider(): ModelProvider {
  return { chat: vi.fn() }
}

function baseClassification(overrides: Partial<contextJudge.IssueClassification> = {}): contextJudge.IssueClassification {
  return {
    isStructural: false,
    isCrossChapter: false,
    isTaskConsistency: false,
    isItemLocationConflict: false,
    isInventedCharacter: false,
    isOutlineStateConflict: false,
    isLocal: false,
    isStateCorruption: false,
    isInterpretive: false,
    ...overrides,
  }
}

describe('isStructuralIssue rule-based classification', () => {
  beforeEach(() => {
    vi.mocked(contextJudge.batchClassifyIssues).mockReset()
  })

  it('classifies outline violations as structural by rule', async () => {
    const issue: Issue = { id: '1', type: 'outline_violation', severity: 'error', description: '缺少大纲事件' }
    const provider = createProvider()
    expect(await isStructuralIssue(provider, issue)).toBe(true)
    expect(contextJudge.batchClassifyIssues).not.toHaveBeenCalled()
  })

  it('classifies outline deviation errors as structural by rule', async () => {
    const issue: Issue = { id: '1', type: 'outline_deviation', severity: 'error', description: '偏离大纲' }
    const provider = createProvider()
    expect(await isStructuralIssue(provider, issue)).toBe(true)
    expect(contextJudge.batchClassifyIssues).not.toHaveBeenCalled()
  })

  it('classifies quality errors as non-structural (local) by rule', async () => {
    const issue: Issue = { id: '1', type: 'quality', severity: 'error', description: '用词重复' }
    const provider = createProvider()
    expect(await isStructuralIssue(provider, issue)).toBe(false)
    expect(contextJudge.batchClassifyIssues).not.toHaveBeenCalled()
  })

  it('classifies consistency errors as structural by rule', async () => {
    const issue: Issue = { id: '1', type: 'consistency', severity: 'error', description: 'cross-chapter fact mismatch' }
    const provider = createProvider()
    expect(await isStructuralIssue(provider, issue)).toBe(true)
    expect(contextJudge.batchClassifyIssues).not.toHaveBeenCalled()
  })

  it('classifies hallucination errors as structural by rule', async () => {
    const issue: Issue = { id: '1', type: 'hallucination', severity: 'error', description: '使用了未介绍的人物' }
    const provider = createProvider()
    expect(await isStructuralIssue(provider, issue)).toBe(true)
    expect(contextJudge.batchClassifyIssues).not.toHaveBeenCalled()
  })
})

describe('isStructuralIssue optional LLM复核', () => {
  beforeEach(() => {
    vi.mocked(contextJudge.batchClassifyIssues).mockReset()
  })

  it('uses LLM classification when preferLLM is true', async () => {
    const issue: Issue = { id: '1', type: 'quality', severity: 'error', description: '用词重复' }
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockResolvedValueOnce([baseClassification({ isStructural: true })])
    expect(await isStructuralIssue(provider, issue, true)).toBe(true)
    expect(contextJudge.batchClassifyIssues).toHaveBeenCalledWith(provider, [issue])
  })

  it('falls back to rule classification when LLM fails', async () => {
    const issue: Issue = { id: '1', type: 'quality', severity: 'error', description: '用词重复' }
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockRejectedValueOnce(new Error('LLM failed'))
    expect(await isStructuralIssue(provider, issue, true)).toBe(false)
  })
})
