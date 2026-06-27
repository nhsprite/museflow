import { describe, expect, it } from 'vitest'
import { filterIssuesAgainstCanonicalFacts } from '../../../src/graph/nodes/validation.js'
import type { Issue } from '../../../src/types/agent.js'
import type { CanonicalFact } from '../../../src/types/story-state.js'

describe('filterIssuesAgainstCanonicalFacts', () => {
  it('filters consistency issue that directly contradicts a canonical fact', () => {
    const issues: Issue[] = [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '某物品不应在实验室A，这与当前情节冲突',
      },
    ]
    const canonicalFacts: CanonicalFact[] = [
      {
        id: 'cf1',
        subject: '某物品',
        attribute: '所在位置',
        value: '某物品在实验室A',
        establishedIn: 2,
      },
    ]

    const filtered = filterIssuesAgainstCanonicalFacts(issues, canonicalFacts)
    expect(filtered).toHaveLength(0)
  })

  it('keeps consistency issue that does not contradict any canonical fact', () => {
    const issues: Issue[] = [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '角色A在本章内前后态度不一致',
      },
    ]
    const canonicalFacts: CanonicalFact[] = [
      {
        id: 'cf1',
        subject: '某物品',
        attribute: '所在位置',
        value: '某物品在实验室A',
        establishedIn: 2,
      },
    ]

    const filtered = filterIssuesAgainstCanonicalFacts(issues, canonicalFacts)
    expect(filtered).toHaveLength(1)
  })

  it('keeps non-consistency issues unchanged', () => {
    const issues: Issue[] = [
      {
        id: '1',
        type: 'outline_violation',
        severity: 'error',
        description: '缺少大纲要求的核心事件',
      },
    ]
    const canonicalFacts: CanonicalFact[] = [
      {
        id: 'cf1',
        subject: '某物品',
        attribute: '所在位置',
        value: '某物品在实验室A',
        establishedIn: 2,
      },
    ]

    const filtered = filterIssuesAgainstCanonicalFacts(issues, canonicalFacts)
    expect(filtered).toHaveLength(1)
  })

  it('does not filter issues without negation markers', () => {
    const issues: Issue[] = [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '某物品在实验室A，但前文说它已被转移到实验室B',
      },
    ]
    const canonicalFacts: CanonicalFact[] = [
      {
        id: 'cf1',
        subject: '某物品',
        attribute: '所在位置',
        value: '某物品在实验室A',
        establishedIn: 2,
      },
    ]

    const filtered = filterIssuesAgainstCanonicalFacts(issues, canonicalFacts)
    expect(filtered).toHaveLength(1)
  })

  it('returns all issues when no canonical facts exist', () => {
    const issues: Issue[] = [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '某物品不应在实验室A',
      },
    ]

    const filtered = filterIssuesAgainstCanonicalFacts(issues, [])
    expect(filtered).toHaveLength(1)
  })
})
