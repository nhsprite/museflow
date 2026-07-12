import { describe, expect, it } from 'vitest'
import {
  classifyIssueByRule,
  isStateCorruptionIssue,
  isStructuralIssue,
  isLocalIssue,
  isInterpretiveIssue,
  isTaskConsistencyIssue,
} from '../../../src/core/chapter-generation/issue-classifier.js'
import type { Issue } from '../../../src/types/agent.js'

function makeIssue(
  type: Issue['type'],
  severity: Issue['severity'],
  description: string,
  location?: string
): Issue {
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
    const issue = makeIssue('consistency', 'warning', 'quality issue')
    issue.dimension = 'quality'
    const result = classifyIssueByRule(issue)
    expect(result.isInterpretive).toBe(true)
    expect(result.isStructural).toBe(false)
    expect(result.isLocal).toBe(false)
  })

  it('classifies quality-dimension errors as local', () => {
    const issue = makeIssue('consistency', 'error', 'quality issue')
    issue.dimension = 'quality'
    const result = classifyIssueByRule(issue)
    expect(result.isLocal).toBe(true)
    expect(result.isStructural).toBe(false)
  })

  it('classifies item location conflicts from structured dimension as state corruption', () => {
    const issue = makeIssue('consistency', 'error', 'structured issue')
    issue.dimension = 'item_location'
    const result = classifyIssueByRule(issue)
    expect(result.isStateCorruption).toBe(true)
    expect(result.isItemLocationConflict).toBe(true)
  })

  it('classifies invented character issues from structured dimension as state corruption', () => {
    const issue = makeIssue('consistency', 'error', 'structured issue')
    issue.dimension = 'invented_character'
    const result = classifyIssueByRule(issue)
    expect(result.isStateCorruption).toBe(true)
    expect(result.isInventedCharacter).toBe(true)
  })

  it('classifies structured_state dimension consistency errors as state corruption', () => {
    const issue = makeIssue('consistency', 'error', '状态记录与已定稿章节正文矛盾')
    issue.dimension = 'structured_state'
    const result = classifyIssueByRule(issue)
    expect(result.isStateCorruption).toBe(true)
    expect(result.isStructural).toBe(true)
    expect(result.isLocal).toBe(false)
  })

  it('classifies space dimension consistency errors as state corruption', () => {
    const issue = makeIssue('consistency', 'error', '物品持有者记录与正文矛盾')
    issue.dimension = 'space'
    const result = classifyIssueByRule(issue)
    expect(result.isStateCorruption).toBe(true)
    expect(result.isLocal).toBe(false)
  })

  it('classifies task-related issues from structured dimension as task consistency', () => {
    const issue = makeIssue('consistency', 'error', 'structured issue')
    issue.dimension = 'task_consistency'
    const result = classifyIssueByRule(issue)
    expect(result.isTaskConsistency).toBe(true)
  })

  it('does not classify consistency errors as interpretive from prose alone', () => {
    const issue = makeIssue('consistency', 'error', 'should add more explanation')
    const result = classifyIssueByRule(issue)
    expect(result.isInterpretive).toBe(false)
    expect(result.isStructural).toBe(true)
    expect(result.isStateCorruption).toBe(false)
  })

  it('classifies consistency errors as interpretive when dimension is quality', () => {
    const issue = makeIssue('consistency', 'error', 'structured issue')
    issue.dimension = 'quality'
    const result = classifyIssueByRule(issue)
    expect(result.isInterpretive).toBe(true)
  })

  it('does not classify state corruption issues as interpretive even with quality dimension', () => {
    const issue = makeIssue('consistency', 'error', 'structured issue')
    issue.dimension = 'state_corruption'
    const result = classifyIssueByRule(issue)
    expect(result.isStateCorruption).toBe(true)
    expect(result.isInterpretive).toBe(false)
  })

  it('classifies quality-dimension errors as interpretive', () => {
    const issue = makeIssue('consistency', 'error', 'structured issue')
    issue.dimension = 'quality'
    const result = classifyIssueByRule(issue)
    expect(result.isInterpretive).toBe(true)
  })
})

describe('issue classifiers are synchronous projections of classifyIssueByRule', () => {
  it('isStateCorruptionIssue projects isStateCorruption', () => {
    const issue = makeIssue('state_corruption', 'error', '上游状态被污染')
    expect(isStateCorruptionIssue(issue)).toBe(true)
  })

  it('isStructuralIssue projects isStructural', () => {
    const issue = makeIssue('outline_violation', 'error', '偏离大纲')
    expect(isStructuralIssue(issue)).toBe(true)
  })

  it('isLocalIssue projects isLocal', () => {
    const issue = makeIssue('consistency', 'error', '段落重复')
    issue.dimension = 'quality'
    expect(isLocalIssue(issue)).toBe(true)
  })

  it('isInterpretiveIssue projects isInterpretive', () => {
    const issue = makeIssue('consistency', 'warning', 'structured issue')
    issue.dimension = 'quality'
    expect(isInterpretiveIssue(issue)).toBe(true)
  })

  it('isTaskConsistencyIssue projects isTaskConsistency', () => {
    const issue = makeIssue('consistency', 'error', 'structured issue')
    issue.dimension = 'task_consistency'
    expect(isTaskConsistencyIssue(issue)).toBe(true)
  })
})
