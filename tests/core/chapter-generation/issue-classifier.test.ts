import { describe, expect, it } from 'vitest'
import {
  isStateCorruptionIssue,
  isItemLocationConflictIssue,
  isInventedCharacterIssue,
  isOutlineStateConflictIssue,
  isStructuralIssue,
} from '../../../src/core/chapter-generation/issue-classifier.js'
import type { Issue } from '../../../src/types/agent.js'

describe('isStateCorruptionIssue', () => {
  it('returns true for item location conflict issues', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: '血封信笺同时出现在妆台抽屉和东院正房妆台暗屉，物品位置矛盾',
    }
    expect(isStateCorruptionIssue(issue)).toBe(true)
  })

  it('returns true for invented character issues', () => {
    const issue: Issue = {
      id: '2',
      type: 'hallucination',
      severity: 'error',
      description: '本章 introduces 虚构角色“李四”，不在官方角色列表中',
    }
    expect(isStateCorruptionIssue(issue)).toBe(true)
  })

  it('returns true for outline state conflict issues', () => {
    const issue: Issue = {
      id: '3',
      type: 'consistency',
      severity: 'error',
      description: '本章与权威事实冲突：canonical fact 中样本位置为实验室A，本章写为实验室B',
    }
    expect(isStateCorruptionIssue(issue)).toBe(true)
  })

  it('returns false for local quality issues', () => {
    const issue: Issue = {
      id: '4',
      type: 'quality',
      severity: 'error',
      description: '用词重复',
    }
    expect(isStateCorruptionIssue(issue)).toBe(false)
  })

  it('returns false for local consistency issues without state corruption markers', () => {
    const issue: Issue = {
      id: '5',
      type: 'consistency',
      severity: 'error',
      description: '本章内部时间顺序不一致',
    }
    expect(isStateCorruptionIssue(issue)).toBe(false)
  })

  it('returns false for interpretive issues', () => {
    const issue: Issue = {
      id: '6',
      type: 'consistency',
      severity: 'error',
      description: '角色反应过于平淡，表达方式可以更好',
    }
    expect(isStateCorruptionIssue(issue)).toBe(false)
  })
})

describe('isItemLocationConflictIssue', () => {
  it('detects location conflict keywords', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: '关键物品位置冲突',
    }
    expect(isItemLocationConflictIssue(issue)).toBe(true)
  })
})

describe('isInventedCharacterIssue', () => {
  it('detects invented character keywords', () => {
    const issue: Issue = {
      id: '1',
      type: 'hallucination',
      severity: 'error',
      description: '虚构角色不在官方角色列表中',
    }
    expect(isInventedCharacterIssue(issue)).toBe(true)
  })
})

describe('isOutlineStateConflictIssue', () => {
  it('detects canonical fact conflict keywords', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: '与权威事实冲突',
    }
    expect(isOutlineStateConflictIssue(issue)).toBe(true)
  })
})

describe('isStructuralIssue', () => {
  it('returns true for outline violations', () => {
    const issue: Issue = {
      id: '1',
      type: 'outline_violation',
      severity: 'error',
      description: '缺少大纲要求的核心事件',
    }
    expect(isStructuralIssue(issue)).toBe(true)
  })

  it('returns true for cross-chapter issues referencing previous chapters', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: '前章中角色A已知某事实，本章却表现得像第一次听说',
    }
    expect(isStructuralIssue(issue)).toBe(true)
  })

  it('returns true for issues referencing canonical facts', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: '本章与权威事实冲突',
    }
    expect(isStructuralIssue(issue)).toBe(true)
  })

  it('returns true for issues referencing pending tasks', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: '角色B未执行已确立的差事',
    }
    expect(isStructuralIssue(issue)).toBe(true)
  })

  it('returns false for local internal consistency issues', () => {
    const issue: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: '本章内部时间顺序不一致',
    }
    expect(isStructuralIssue(issue)).toBe(false)
  })

  it('returns false for quality issues', () => {
    const issue: Issue = {
      id: '1',
      type: 'quality',
      severity: 'error',
      description: '用词重复',
    }
    expect(isStructuralIssue(issue)).toBe(false)
  })
})
