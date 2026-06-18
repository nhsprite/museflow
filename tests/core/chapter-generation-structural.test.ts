import { describe, expect, it } from 'vitest'
import { isStructuralIssue } from '../../src/core/chapter-generation.js'
import type { Issue } from '../../src/types/agent.js'

describe('isStructuralIssue', () => {
  it('returns true for outline violation issues', () => {
    const issue: Issue = {
      id: '1',
      type: 'outline_violation',
      severity: 'error',
      description: '缺少大纲事件',
    }
    expect(isStructuralIssue(issue)).toBe(true)
  })

  it('returns false for generic outline deviation issues', () => {
    const issue: Issue = {
      id: '1',
      type: 'outline_deviation',
      severity: 'error',
      description: '偏离大纲',
    }
    expect(isStructuralIssue(issue)).toBe(false)
  })

  it('returns true for outline deviation issues involving missing core events', () => {
    const issue: Issue = {
      id: '1',
      type: 'outline_deviation',
      severity: 'error',
      description: '缺少核心事件：主角未出现',
    }
    expect(isStructuralIssue(issue)).toBe(true)
  })

  it('returns false for local quality issues', () => {
    const issue: Issue = {
      id: '1',
      type: 'quality',
      severity: 'error',
      description: '用词重复',
    }
    expect(isStructuralIssue(issue)).toBe(false)
  })

  it('returns false for generic consistency issues without cross-chapter markers', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: 'cross-chapter fact mismatch',
    }
    expect(isStructuralIssue(issue)).toBe(false)
  })

  it('returns true for consistency issues referencing previous chapters', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: '第29章中六耳猕猴已被封入锦囊，本章却写他被如来降伏',
    }
    expect(isStructuralIssue(issue)).toBe(true)
  })

  it('returns true for consistency issues referencing story state', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: '与story_state记录的角色位置矛盾',
    }
    expect(isStructuralIssue(issue)).toBe(true)
  })

  it('returns true for hallucination issues referencing previous chapters', () => {
    const issue: Issue = {
      id: '1',
      type: 'hallucination',
      severity: 'error',
      description: '上一章已说明六耳猕猴被封印，本章却写他逃脱',
      location: '开篇段落',
    }
    expect(isStructuralIssue(issue)).toBe(true)
  })

  it('returns false for local hallucination issues', () => {
    const issue: Issue = {
      id: '1',
      type: 'hallucination',
      severity: 'error',
      description: '使用了未介绍的人物',
    }
    expect(isStructuralIssue(issue)).toBe(false)
  })
})
