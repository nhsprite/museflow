import { describe, expect, it } from 'vitest'
import { applyIssuePolicy } from '../../../../src/core/chapter-generation/routing/issue-policy.js'
import type { Issue } from '../../../../src/types/agent.js'
import type { ChapterPlanningConfig } from '../../../../src/types/genre.js'

const planningConfig: ChapterPlanningConfig = {
  maxNonErrorIssuesPerType: 3,
} as ChapterPlanningConfig

function makeIssue(id: string, type: Issue['type'], severity: Issue['severity'], description: string): Issue {
  return { id, type, severity, description }
}

describe('applyIssuePolicy', () => {
  it('deduplicates issues by rule by default', async () => {
    const issues: Issue[] = [
      makeIssue('a', 'consistency', 'error', '应明确写出原定计划被改期的原因'),
      makeIssue('b', 'consistency', 'error', '应明确写出原定计划被改期的原因'),
      makeIssue('c', 'consistency', 'warning', '段落节奏拖沓'),
    ]

    const result = await applyIssuePolicy(issues, {
      planningConfig,
      isInterpretiveIssue: () => false,
    })

    expect(result.issues).toHaveLength(2)
    expect(result.issues.map(i => i.id).sort()).toEqual(['a', 'c'])
  })

  it('caps non-error issues per type', async () => {
    const issues: Issue[] = [
      makeIssue('e1', 'consistency', 'error', '硬性矛盾'),
      makeIssue('w1', 'consistency', 'warning', '描写冗长'),
      makeIssue('w2', 'consistency', 'warning', '表达生硬'),
      makeIssue('w3', 'consistency', 'warning', '节奏拖沓'),
      makeIssue('w4', 'consistency', 'warning', '措辞不当'),
    ]

    const result = await applyIssuePolicy(issues, {
      planningConfig,
      isInterpretiveIssue: () => false,
    })

    const errors = result.issues.filter(i => i.severity === 'error')
    const warnings = result.issues.filter(i => i.severity === 'warning')
    expect(errors).toHaveLength(1)
    expect(warnings).toHaveLength(3)
    expect(result.cappedTypes).toContain('consistency')
  })

  it('keeps all issues when deduplicateIssues is not provided and no capping needed', async () => {
    const issues: Issue[] = [
      makeIssue('a', 'consistency', 'error', '应明确写出原定计划被改期的原因'),
      makeIssue('b', 'outline_violation', 'error', '缺少大纲核心事件'),
    ]

    const result = await applyIssuePolicy(issues, {
      planningConfig,
      isInterpretiveIssue: () => false,
    })

    expect(result.issues).toHaveLength(2)
  })
})
