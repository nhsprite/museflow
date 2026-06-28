import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as contextJudge from '../../../src/utils/context-judge.js'
import {
  isStateCorruptionIssue,
  isStructuralIssue,
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

describe('isStateCorruptionIssue', () => {
  beforeEach(() => {
    vi.mocked(contextJudge.batchClassifyIssues).mockReset()
  })

  it('returns true when the model classifies the issue as state corruption', async () => {
    const issue: Issue = { id: '1', type: 'consistency', severity: 'error', description: 'sample' }
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockResolvedValueOnce([baseClassification({ isStateCorruption: true })])
    expect(await isStateCorruptionIssue(provider, issue)).toBe(true)
    expect(contextJudge.batchClassifyIssues).toHaveBeenCalledWith(provider, [issue])
  })

  it('returns false when the model classifies the issue as not state corruption', async () => {
    const issue: Issue = { id: '2', type: 'quality', severity: 'error', description: 'sample' }
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockResolvedValueOnce([baseClassification({ isStateCorruption: false })])
    expect(await isStateCorruptionIssue(provider, issue)).toBe(false)
  })

  it('falls back conservatively when no provider is given', async () => {
    const issue: Issue = { id: '3', type: 'state_corruption', severity: 'error', description: 'sample' }
    expect(await isStateCorruptionIssue(undefined, issue)).toBe(true)
  })
})

describe('isStructuralIssue', () => {
  beforeEach(() => {
    vi.mocked(contextJudge.batchClassifyIssues).mockReset()
  })

  it('returns the model classification for structural issues', async () => {
    const issue: Issue = { id: '1', type: 'outline_violation', severity: 'error', description: 'sample' }
    const provider = createProvider()
    vi.mocked(contextJudge.batchClassifyIssues).mockResolvedValueOnce([baseClassification({ isStructural: true })])
    expect(await isStructuralIssue(provider, issue)).toBe(true)
  })

  it('falls back to severity-based structural detection when no provider is given', async () => {
    const issue: Issue = { id: '2', type: 'quality', severity: 'error', description: 'sample' }
    expect(await isStructuralIssue(undefined, issue)).toBe(true)
  })

  it('falls back to non-structural for warnings when no provider is given', async () => {
    const issue: Issue = { id: '3', type: 'quality', severity: 'warning', description: 'sample' }
    expect(await isStructuralIssue(undefined, issue)).toBe(false)
  })
})
