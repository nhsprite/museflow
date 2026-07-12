import { describe, expect, it } from 'vitest'
import { deduplicateByRule } from '../../src/utils/issue-deduplication.js'
import { generateIssueFingerprint } from '../../src/utils/context-judge.js'
import type { Issue } from '../../src/types/agent.js'

describe('generateIssueFingerprint（统一规则指纹）', () => {
  it('uses structured subject rather than rephrased descriptions', () => {
    const a: Issue = {
      id: '1',
      type: 'hallucination',
      severity: 'error',
      description: '角色乙不在官方角色列表',
      subject: '角色乙',
    }
    const b: Issue = {
      id: '2',
      type: 'hallucination',
      severity: 'error',
      description: '角色乙不在官方角色列表中',
      subject: '角色乙',
    }
    expect(generateIssueFingerprint(a)).toBe(generateIssueFingerprint(b))
  })

  it('produces different fingerprints for different structured locations', () => {
    const a: Issue = {
      id: '1',
      type: 'hallucination',
      severity: 'error',
      description: '角色甲不在官方列表',
      locationRef: { paragraphIndex: 0 },
    }
    const b: Issue = {
      id: '2',
      type: 'hallucination',
      severity: 'error',
      description: '角色乙不在官方列表',
      locationRef: { paragraphIndex: 1 },
    }
    expect(generateIssueFingerprint(a)).not.toBe(generateIssueFingerprint(b))
  })

  it('ignores natural-language location strings', () => {
    const a: Issue = {
      id: '1',
      type: 'hallucination',
      severity: 'error',
      description: '角色甲不在官方列表',
      location: '第1段',
    }
    const b: Issue = {
      id: '2',
      type: 'hallucination',
      severity: 'error',
      description: '角色甲不在官方列表',
      location: '第2段',
    }
    expect(generateIssueFingerprint(a)).toBe(generateIssueFingerprint(b))
  })

  it('distinguishes generic fingerprints whose descriptions differ only in numbers', () => {
    // 新指纹（colon 格式）对无 subject/locationRef 的泛化问题使用 description 哈希，
    // 不再做数字归一化：措辞不同即视为不同问题。
    const a: Issue = {
      id: '1',
      type: 'quality',
      severity: 'warning',
      description: '第12章字数不足',
    }
    const b: Issue = { id: '2', type: 'quality', severity: 'warning', description: '第3章字数不足' }
    expect(generateIssueFingerprint(a)).not.toBe(generateIssueFingerprint(b))
  })

  it('does not normalize quoted natural-language entities in generic fingerprints', () => {
    // 泛化指纹按 description 原文哈希，「…」与“…”视为不同描述。
    const a: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: '「长命锁」不应出现在当铺',
    }
    const b: Issue = {
      id: '2',
      type: 'consistency',
      severity: 'error',
      description: '“长命锁”不应出现在当铺',
    }
    expect(generateIssueFingerprint(a)).not.toBe(generateIssueFingerprint(b))
  })

  it('produces different fingerprints for different subjects', () => {
    const a: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: '位置描述前后矛盾',
      subject: '角色甲',
    }
    const b: Issue = {
      id: '2',
      type: 'consistency',
      severity: 'error',
      description: '位置描述前后矛盾',
      subject: '角色乙',
    }
    expect(generateIssueFingerprint(a)).not.toBe(generateIssueFingerprint(b))
  })

  it('produces the same fingerprint for the same subject despite rephrasing', () => {
    const a: Issue = {
      id: '1',
      type: 'consistency',
      severity: 'error',
      description: '角色甲位置前后矛盾',
      subject: '角色甲',
    }
    const b: Issue = {
      id: '2',
      type: 'consistency',
      severity: 'error',
      description: '角色甲的位置描写存在出入',
      subject: '角色甲',
    }
    expect(generateIssueFingerprint(a)).toBe(generateIssueFingerprint(b))
  })
})

describe('deduplicateByRule', () => {
  it('does not fold same-type issues with different subjects', () => {
    const issues: Issue[] = [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '角色甲位置前后矛盾',
        subject: '角色甲',
      },
      {
        id: '2',
        type: 'consistency',
        severity: 'error',
        description: '角色乙位置前后矛盾',
        subject: '角色乙',
      },
    ]
    expect(deduplicateByRule(issues)).toHaveLength(2)
  })

  it('folds duplicate issues with the same subject', () => {
    const issues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'error', description: '描述一', subject: '角色甲' },
      { id: '2', type: 'consistency', severity: 'error', description: '描述二', subject: '角色甲' },
    ]
    const deduped = deduplicateByRule(issues)
    expect(deduped).toHaveLength(1)
    expect(deduped[0]!.id).toBe('1')
  })

  it('does not fold distinct issues that lack both subject and locationRef', () => {
    const issues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'warning', description: '角色甲反应过于平淡' },
      { id: '2', type: 'consistency', severity: 'warning', description: '角色乙动机缺少铺垫' },
    ]
    expect(deduplicateByRule(issues)).toHaveLength(2)
  })

  it('still folds exact duplicate records without subject and locationRef', () => {
    const issues: Issue[] = [
      { id: '1', type: 'consistency', severity: 'warning', description: '完全相同的泛化警告' },
      { id: '2', type: 'consistency', severity: 'warning', description: '完全相同的泛化警告' },
    ]
    const deduped = deduplicateByRule(issues)
    expect(deduped).toHaveLength(1)
    expect(deduped[0]!.id).toBe('1')
  })

  it('does not fold different descriptions sharing a structured locationRef', () => {
    // colon 指纹在 locationRef 分支同时包含 description 哈希：
    // 同一位置但措辞不同的问题视为不同问题，不再折叠。
    const issues: Issue[] = [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '描述一',
        locationRef: { paragraphIndex: 0, sentenceIndex: 1 },
      },
      {
        id: '2',
        type: 'consistency',
        severity: 'error',
        description: '描述二',
        locationRef: { paragraphIndex: 0, sentenceIndex: 1 },
      },
    ]
    expect(deduplicateByRule(issues)).toHaveLength(2)
  })

  it('still folds identical issues sharing a structured locationRef', () => {
    const issues: Issue[] = [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '相同描述',
        locationRef: { paragraphIndex: 0, sentenceIndex: 1 },
      },
      {
        id: '2',
        type: 'consistency',
        severity: 'error',
        description: '相同描述',
        locationRef: { paragraphIndex: 0, sentenceIndex: 1 },
      },
    ]
    const deduped = deduplicateByRule(issues)
    expect(deduped).toHaveLength(1)
    expect(deduped[0]!.id).toBe('1')
  })
})
