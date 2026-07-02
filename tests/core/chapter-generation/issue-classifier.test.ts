import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as contextJudge from '../../../src/utils/context-judge.js'
import {
  classifyIssueByRule,
  isStateCorruptionIssue,
  isStructuralIssue,
  isLocalIssue,
  isInterpretiveIssue,
  isTaskConsistencyIssue,
} from '../../../src/core/chapter-generation/issue-classifier.js'
import type { Issue } from '../../../src/types/agent.js'
import type { ModelProvider } from '../../../src/model/provider.js'

vi.mock('../../../src/utils/context-judge.js', async (importOriginal) => {
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

function makeIssue(type: Issue['type'], severity: Issue['severity'], description: string, location?: string): Issue {
  return { id: '1', type, severity, description, ...(location ? { location } : {}) }
}

describe('classifyIssueByRule', () => {
  it('classifies state_corruption as structural and state corruption', () => {
    const issue = makeIssue('state_corruption', 'error', '上游状态被污染')
    const result = classifyIssueByRule(issue)
    expect(result.isStructural).toBe(true)
    expect(result.isStateCorruption).toBe(true)
    expect(result.isLocal).toBe(false)
  })

  it('classifies outline violations as structural', () => {
    const issue = makeIssue('outline_violation', 'error', '偏离大纲')
    const result = classifyIssueByRule(issue)
    expect(result.isStructural).toBe(true)
    expect(result.isLocal).toBe(false)
  })

  it('classifies word_count errors as structural', () => {
    const issue = makeIssue('word_count', 'error', '字数不足')
    const result = classifyIssueByRule(issue)
    expect(result.isStructural).toBe(true)
  })

  it('classifies consistency errors as structural and cross-chapter', () => {
    const issue = makeIssue('consistency', 'error', '角色知识与上一章矛盾')
    const result = classifyIssueByRule(issue)
    expect(result.isStructural).toBe(true)
    expect(result.isCrossChapter).toBe(true)
  })

  it('classifies world_integrity consistency errors as structural', () => {
    const issue = makeIssue('consistency', 'error', '发明了不存在的设定')
    issue.dimension = 'world_integrity'
    const result = classifyIssueByRule(issue)
    expect(result.isStructural).toBe(true)
  })

  it('classifies quality-dimension warnings as interpretive when keywords match', () => {
    const issue = makeIssue('consistency', 'warning', '描写冗长拖沓')
    issue.dimension = 'quality'
    const result = classifyIssueByRule(issue)
    expect(result.isInterpretive).toBe(true)
    expect(result.isStructural).toBe(false)
    expect(result.isLocal).toBe(false)
  })

  it('classifies quality-dimension errors as local', () => {
    const issue = makeIssue('consistency', 'error', '段落重复')
    issue.dimension = 'quality'
    const result = classifyIssueByRule(issue)
    expect(result.isLocal).toBe(true)
    expect(result.isStructural).toBe(false)
  })

  it('classifies item location conflicts as state corruption', () => {
    const issue = makeIssue('consistency', 'error', '物品位置冲突：血封信笺同时出现在两个位置')
    const result = classifyIssueByRule(issue)
    expect(result.isStateCorruption).toBe(true)
    expect(result.isItemLocationConflict).toBe(true)
  })

  it('classifies invented character issues as state corruption', () => {
    const issue = makeIssue('consistency', 'error', '本章出现虚构角色张三')
    const result = classifyIssueByRule(issue)
    expect(result.isStateCorruption).toBe(true)
    expect(result.isInventedCharacter).toBe(true)
  })

  it('classifies task-related issues as task consistency', () => {
    const issue = makeIssue('consistency', 'error', '前章差事截止本章未完成')
    const result = classifyIssueByRule(issue)
    expect(result.isTaskConsistency).toBe(true)
  })

  it('classifies consistency errors with writing-guide keywords as interpretive', () => {
    const issue = makeIssue('consistency', 'error', '应明确写出原定计划被改期的原因')
    const result = classifyIssueByRule(issue)
    expect(result.isInterpretive).toBe(true)
    expect(result.isStructural).toBe(true)
    expect(result.isStateCorruption).toBe(false)
  })

  it('classifies "should add description" consistency errors as interpretive', () => {
    const issue = makeIssue('consistency', 'error', '应增加沈砚秋对信使身份的风险评估描写')
    const result = classifyIssueByRule(issue)
    expect(result.isInterpretive).toBe(true)
  })

  it('does not classify state corruption issues as interpretive even with writing-guide keywords', () => {
    const issue = makeIssue('consistency', 'error', '物品位置冲突：应明确写出信物当前唯一位置')
    const result = classifyIssueByRule(issue)
    expect(result.isStateCorruption).toBe(true)
    expect(result.isInterpretive).toBe(false)
  })

  it('classifies quality-dimension errors with interpretive keywords as interpretive', () => {
    const issue = makeIssue('consistency', 'error', '段落重复')
    issue.dimension = 'quality'
    const result = classifyIssueByRule(issue)
    expect(result.isInterpretive).toBe(true)
  })
})

describe('issue classifiers default to rule-based classification', () => {
  beforeEach(() => {
    vi.mocked(contextJudge.batchClassifyIssues).mockReset()
  })

  it('does not call LLM for state corruption classification by default', async () => {
    const issue = makeIssue('state_corruption', 'error', '上游状态被污染')
    const provider = createProvider()
    const result = await isStateCorruptionIssue(provider, issue)
    expect(result).toBe(true)
    expect(contextJudge.batchClassifyIssues).not.toHaveBeenCalled()
  })

  it('does not call LLM for structural classification by default', async () => {
    const issue = makeIssue('outline_violation', 'error', '偏离大纲')
    const provider = createProvider()
    const result = await isStructuralIssue(provider, issue)
    expect(result).toBe(true)
    expect(contextJudge.batchClassifyIssues).not.toHaveBeenCalled()
  })

  it('does not call LLM for local classification by default', async () => {
    const issue = makeIssue('consistency', 'error', '段落重复')
    issue.dimension = 'quality'
    const provider = createProvider()
    const result = await isLocalIssue(provider, issue)
    expect(result).toBe(true)
    expect(contextJudge.batchClassifyIssues).not.toHaveBeenCalled()
  })

  it('does not call LLM for interpretive classification by default', async () => {
    const issue = makeIssue('consistency', 'warning', '描写冗长拖沓')
    issue.dimension = 'quality'
    const provider = createProvider()
    const result = await isInterpretiveIssue(provider, issue)
    expect(result).toBe(true)
    expect(contextJudge.batchClassifyIssues).not.toHaveBeenCalled()
  })

  it('does not call LLM for task consistency classification by default', async () => {
    const issue = makeIssue('consistency', 'error', '前章差事截止本章未完成')
    const provider = createProvider()
    const result = await isTaskConsistencyIssue(provider, issue)
    expect(result).toBe(true)
    expect(contextJudge.batchClassifyIssues).not.toHaveBeenCalled()
  })
})

describe('issue classifiers support optional LLM复核', () => {
  beforeEach(() => {
    vi.mocked(contextJudge.batchClassifyIssues).mockReset()
  })

  it('calls LLM when preferLLM is true', async () => {
    const issue = makeIssue('consistency', 'error', '段落重复')
    issue.dimension = 'quality'
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockResolvedValueOnce([baseClassification({ isLocal: true })])
    const result = await isLocalIssue(provider, issue, true)
    expect(result).toBe(true)
    expect(contextJudge.batchClassifyIssues).toHaveBeenCalledWith(provider, [issue])
  })

  it('falls back to rule result when LLM fails', async () => {
    const issue = makeIssue('state_corruption', 'error', '上游状态被污染')
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockRejectedValueOnce(new Error('LLM failed'))
    const result = await isStateCorruptionIssue(provider, issue, true)
    expect(result).toBe(true)
  })
})

describe('classifiers work without provider', () => {
  it('returns rule result when provider is undefined', async () => {
    const issue = makeIssue('state_corruption', 'error', '上游状态被污染')
    expect(await isStateCorruptionIssue(undefined, issue)).toBe(true)
  })
})
