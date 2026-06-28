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

describe('isStructuralIssue', () => {
  beforeEach(() => {
    vi.mocked(contextJudge.batchClassifyIssues).mockReset()
  })

  it('returns the model classification for outline violations', async () => {
    const issue: Issue = { id: '1', type: 'outline_violation', severity: 'error', description: '缺少大纲事件' }
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockResolvedValueOnce([baseClassification({ isStructural: true })])
    expect(await isStructuralIssue(provider, issue)).toBe(true)
  })

  it('returns the model classification for generic outline deviation issues', async () => {
    const issue: Issue = { id: '1', type: 'outline_deviation', severity: 'error', description: '偏离大纲' }
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockResolvedValueOnce([baseClassification({ isStructural: false })])
    expect(await isStructuralIssue(provider, issue)).toBe(false)
  })

  it('returns the model classification for outline deviation issues involving missing core events', async () => {
    const issue: Issue = { id: '1', type: 'outline_deviation', severity: 'error', description: '缺少核心事件：主角未出现' }
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockResolvedValueOnce([baseClassification({ isStructural: true })])
    expect(await isStructuralIssue(provider, issue)).toBe(true)
  })

  it('returns the model classification for local quality issues', async () => {
    const issue: Issue = { id: '1', type: 'quality', severity: 'error', description: '用词重复' }
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockResolvedValueOnce([baseClassification({ isStructural: false })])
    expect(await isStructuralIssue(provider, issue)).toBe(false)
  })

  it('returns the model classification for generic consistency issues without cross-chapter markers', async () => {
    const issue: Issue = { id: '1', type: 'consistency', severity: 'error', description: 'cross-chapter fact mismatch' }
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockResolvedValueOnce([baseClassification({ isStructural: false })])
    expect(await isStructuralIssue(provider, issue)).toBe(false)
  })

  it('returns the model classification for consistency issues referencing previous chapters', async () => {
    const issue: Issue = { id: '1', type: 'consistency', severity: 'error', description: '第29章中六耳猕猴已被封入锦囊，本章却写他被如来降伏' }
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockResolvedValueOnce([baseClassification({ isStructural: true })])
    expect(await isStructuralIssue(provider, issue)).toBe(true)
  })

  it('returns the model classification for consistency issues referencing story state', async () => {
    const issue: Issue = { id: '1', type: 'consistency', severity: 'error', description: '与story_state记录的角色位置矛盾' }
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockResolvedValueOnce([baseClassification({ isStructural: true })])
    expect(await isStructuralIssue(provider, issue)).toBe(true)
  })

  it('returns the model classification for hallucination issues referencing previous chapters', async () => {
    const issue: Issue = { id: '1', type: 'hallucination', severity: 'error', description: '上一章已说明六耳猕猴被封印，本章却写他逃脱', location: '开篇段落' }
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockResolvedValueOnce([baseClassification({ isStructural: true })])
    expect(await isStructuralIssue(provider, issue)).toBe(true)
  })

  it('returns the model classification for local hallucination issues', async () => {
    const issue: Issue = { id: '1', type: 'hallucination', severity: 'error', description: '使用了未介绍的人物' }
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockResolvedValueOnce([baseClassification({ isStructural: false })])
    expect(await isStructuralIssue(provider, issue)).toBe(false)
  })
})
