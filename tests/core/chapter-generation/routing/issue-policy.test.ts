import { describe, expect, it } from 'vitest'
import { applyIssuePolicy } from '../../../../src/core/chapter-generation/routing/issue-policy.js'
import type { Issue } from '../../../../src/types/agent.js'
import type { ChapterPlanningConfig } from '../../../../src/types/genre.js'

const planningConfig: ChapterPlanningConfig = {
  maxNonErrorIssuesPerType: 3,
} as ChapterPlanningConfig

function makeIssue(
  id: string,
  type: Issue['type'],
  severity: Issue['severity'],
  description: string,
  location?: string,
  paragraphIndex?: number
): Issue {
  return {
    id,
    type,
    severity,
    description,
    ...(location ? { location } : {}),
    ...(paragraphIndex !== undefined ? { locationRef: { paragraphIndex } } : {}),
  }
}

describe('applyIssuePolicy', () => {
  it('deduplicates issues by rule by default', async () => {
    const issues: Issue[] = [
      {
        ...makeIssue('a', 'consistency', 'error', '应明确写出原定计划被改期的原因'),
        subject: '同一对象',
      },
      {
        ...makeIssue('b', 'consistency', 'error', '应明确写出原定计划被改期的原因'),
        subject: '同一对象',
      },
      makeIssue('c', 'consistency', 'warning', '段落节奏拖沓'),
    ]

    const result = await applyIssuePolicy(issues, {
      planningConfig,
      isInterpretiveIssue: () => false,
    })

    expect(result.issues).toHaveLength(2)
    expect(result.issues.map((i) => i.id).sort()).toEqual(['a', 'c'])
  })

  it('caps non-error issues per type', async () => {
    const issues: Issue[] = [
      makeIssue('e1', 'consistency', 'error', '硬性矛盾'),
      makeIssue('w1', 'consistency', 'warning', '描写冗长', '第1段', 0),
      makeIssue('w2', 'consistency', 'warning', '表达生硬', '第2段', 1),
      makeIssue('w3', 'consistency', 'warning', '节奏拖沓', '第3段', 2),
      makeIssue('w4', 'consistency', 'warning', '措辞不当', '第4段', 3),
    ]

    const result = await applyIssuePolicy(issues, {
      planningConfig,
      isInterpretiveIssue: () => false,
    })

    const errors = result.issues.filter((i) => i.severity === 'error')
    const warnings = result.issues.filter((i) => i.severity === 'warning')
    expect(errors).toHaveLength(1)
    expect(warnings).toHaveLength(3)
    // 超出上限时保留最新的 N 个，丢弃最旧的。
    expect(warnings.map((i) => i.id)).toEqual(['w2', 'w3', 'w4'])
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
