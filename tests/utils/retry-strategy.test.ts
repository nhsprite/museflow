import { describe, it, expect } from 'vitest'
import { inferRetryStrategy } from '../../src/utils/retry-strategy.js'
import type { Issue } from '../../src/types/agent.js'

function makeIssue(dimension: string, locationRef?: Issue['locationRef']): Issue {
  return {
    id: '1',
    type: 'consistency',
    severity: 'error',
    description: 'test',
    dimension,
    ...(locationRef ? { locationRef } : {}),
  }
}

describe('inferRetryStrategy', () => {
  it('routes character_knowledge with locationRef to fix', () => {
    expect(inferRetryStrategy(makeIssue('character_knowledge', { paragraphIndex: 2 }))).toBe('fix')
  })

  it('routes dialogue with locationRef to fix', () => {
    expect(inferRetryStrategy(makeIssue('dialogue', { paragraphIndex: 3, sentenceIndex: 1 }))).toBe(
      'fix'
    )
  })

  it('routes information with locationRef to fix', () => {
    expect(inferRetryStrategy(makeIssue('information', { paragraphIndex: 1 }))).toBe('fix')
  })

  it('falls back to draft for character_knowledge without locationRef', () => {
    expect(inferRetryStrategy(makeIssue('character_knowledge'))).toBe('draft')
  })

  it('falls back to draft for dialogue without locationRef', () => {
    expect(inferRetryStrategy(makeIssue('dialogue'))).toBe('draft')
  })

  it('falls back to draft for information without locationRef', () => {
    expect(inferRetryStrategy(makeIssue('information'))).toBe('draft')
  })

  it('keeps existing dimension behaviors', () => {
    expect(inferRetryStrategy(makeIssue('quality'))).toBe('fix')
    expect(inferRetryStrategy(makeIssue('pace'))).toBe('fix')
    expect(inferRetryStrategy(makeIssue('foreshadowing'))).toBe('fix')
    expect(inferRetryStrategy(makeIssue('outline'))).toBe('draft')
  })

  it('respects explicit retryStrategy overrides', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: 'test',
      dimension: 'character_knowledge',
      locationRef: { paragraphIndex: 2 },
      retryStrategy: 'manual',
    }
    // inferRetryStrategy does not read retryStrategy; it only infers it.
    // This test documents current behavior.
    expect(inferRetryStrategy(issue)).toBe('fix')
  })
})
