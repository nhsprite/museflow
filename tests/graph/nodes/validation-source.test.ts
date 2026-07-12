import { describe, expect, it } from 'vitest'
import { tagIssueSource } from '../../../src/graph/nodes/validation.js'
import { inferRetryStrategy } from '../../../src/utils/retry-strategy.js'
import type { Issue } from '../../../src/types/agent.js'

describe('tagIssueSource', () => {
  it('adds source and retryStrategy to an issue', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: 'test',
    }
    const tagged = tagIssueSource(issue, 'consistency', 'draft')
    expect(tagged.source).toBe('consistency')
    expect(tagged.retryStrategy).toBe('draft')
    expect(tagged.type).toBe('consistency')
  })
})

describe('inferRetryStrategy', () => {
  it('maps word_count issues to fix', () => {
    const issue: Issue = {
      id: '1',
      type: 'word_count',
      severity: 'error',
      description: 'too short',
    }
    expect(inferRetryStrategy(issue)).toBe('fix')
  })

  it('maps outline violations to draft', () => {
    const issue: Issue = {
      id: '1',
      type: 'outline_violation',
      severity: 'error',
      description: 'missing event',
    }
    expect(inferRetryStrategy(issue)).toBe('draft')
  })

  it('maps quality consistency issues to fix', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: 'redundant wording',
      dimension: 'quality',
    }
    expect(inferRetryStrategy(issue)).toBe('fix')
  })

  it('maps state corruption issues to manual', () => {
    const issue: Issue = {
      id: '1',
      type: 'state_corruption',
      severity: 'error',
      description: 'item location conflict',
    }
    expect(inferRetryStrategy(issue)).toBe('manual')
  })

  it('maps character knowledge issues to draft', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: 'character knows too much',
      dimension: 'character_knowledge',
    }
    expect(inferRetryStrategy(issue)).toBe('draft')
  })
})
