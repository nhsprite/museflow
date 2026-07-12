import { describe, expect, it } from 'vitest'
import { isStructuralIssue } from '../../src/core/chapter-generation/issue-classifier.js'
import type { Issue } from '../../src/types/agent.js'

describe('isStructuralIssue rule-based classification', () => {
  it('classifies outline violations as structural by rule', () => {
    const issue: Issue = {
      id: '1',
      type: 'outline_violation',
      severity: 'error',
      description: '缺少大纲事件',
    }
    expect(isStructuralIssue(issue)).toBe(true)
  })

  it('classifies outline deviation errors as structural by rule', () => {
    const issue: Issue = {
      id: '1',
      type: 'outline_deviation',
      severity: 'error',
      description: '偏离大纲',
    }
    expect(isStructuralIssue(issue)).toBe(true)
  })

  it('classifies quality-dimension errors as non-structural (local) by rule', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: '用词重复',
      dimension: 'quality',
    }
    expect(isStructuralIssue(issue)).toBe(false)
  })

  it('classifies consistency errors as structural by rule', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: 'cross-chapter fact mismatch',
    }
    expect(isStructuralIssue(issue)).toBe(true)
  })

  it('classifies world_integrity consistency errors as structural by rule', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: '使用了未介绍的人物',
      dimension: 'world_integrity',
    }
    expect(isStructuralIssue(issue)).toBe(true)
  })
})
