import { describe, expect, it, vi } from 'vitest'
import {
  splitIntoParagraphs,
  extractIssueKeywords,
  findAffectedParagraphs,
  mergeParagraphFixes,
  applyParagraphDiffProtection,
  deduplicateSentences,
} from '../../src/graph/nodes.js'
import type { Message, ModelProvider } from '../../src/model/provider.ts'
import type { AgentState } from '../../src/agents/base.ts'

const mockChat = vi.fn(async (): Promise<string> => '')

vi.mock('../../src/model/registry.ts', () => ({
  createProvider: (): ModelProvider => ({
    chat: mockChat,
  }),
}))

describe('splitIntoParagraphs', () => {
  it('splits text by double newlines', () => {
    const text = '第一段\n\n第二段\n\n第三段'
    const result = splitIntoParagraphs(text)
    expect(result).toHaveLength(3)
    expect(result[0]).toBe('第一段')
    expect(result[1]).toBe('第二段')
    expect(result[2]).toBe('第三段')
  })

  it('filters out empty paragraphs', () => {
    const text = '第一段\n\n\n\n第二段\n\n   \n\n第三段'
    const result = splitIntoParagraphs(text)
    expect(result).toHaveLength(3)
  })

  it('handles single paragraph', () => {
    const text = '只有一段'
    const result = splitIntoParagraphs(text)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('只有一段')
  })

  it('handles empty string', () => {
    const result = splitIntoParagraphs('')
    expect(result).toHaveLength(0)
  })
})

describe('extractIssueKeywords', () => {
  it('extracts quoted text', () => {
    const issue = {
      description: '句子"一阵敲门声"出现了两次',
      location: '第五章开头',
    }
    const keywords = extractIssueKeywords(issue)
    expect(keywords).toContain('一阵敲门声')
  })

  it('extracts Chinese phrases', () => {
    const issue = {
      description: '时间线混乱，高烧三日与一夜矛盾',
    }
    const keywords = extractIssueKeywords(issue)
    expect(keywords).toContain('时间线')
    expect(keywords).toContain('混乱')
    expect(keywords).toContain('高烧')
    expect(keywords).toContain('三日')
    expect(keywords).toContain('一夜')
    expect(keywords).toContain('矛盾')
    expect(keywords).toContain('时间线混乱')
    expect(keywords).toContain('高烧三日')
  })

  it('deduplicates keywords', () => {
    const issue = {
      description: '张三说"你好"，李四也说"你好"',
    }
    const keywords = extractIssueKeywords(issue)
    const nihaoCount = keywords.filter(k => k === '你好').length
    expect(nihaoCount).toBe(1)
  })

  it('filters out single characters', () => {
    const issue = {
      description: 'a b c',
    }
    const keywords = extractIssueKeywords(issue)
    expect(keywords.every(k => k.length >= 2)).toBe(true)
  })

  it('combines description and location', () => {
    const issue = {
      description: '人物名称错误',
      location: '第三章·第二节',
    }
    const keywords = extractIssueKeywords(issue)
    expect(keywords).toContain('人物名称')
    expect(keywords).toContain('错误')
    expect(keywords).toContain('第三章')
    expect(keywords).toContain('第二节')
  })
})

describe('findAffectedParagraphs', () => {
  const paragraphs = [
    '沈惊鸿走在青石板路上。',
    '一阵急促的敲门声将他从梦中唤醒。',
    '他打开房门，看到一位红衣女子。',
    '女子自称红菱，来自远方的绣坊。',
  ]

  it('finds paragraphs matching issue keywords', () => {
    const issues = [
      { description: '"红衣女子"应该改为"红菱"', location: '第三段' },
    ]
    const affected = findAffectedParagraphs(paragraphs, issues)
    expect(affected).toContain(2)
    expect(affected).toContain(3)
  })

  it('finds multiple affected paragraphs for one issue', () => {
    const issues = [
      { description: '沈惊鸿的名字写错了', location: '全文' },
    ]
    const affected = findAffectedParagraphs(paragraphs, issues)
    expect(affected).toContain(0)
  })

  it('returns empty array when no matches', () => {
    const issues = [
      { description: '"不存在的句子"有问题', location: '某段' },
    ]
    const affected = findAffectedParagraphs(paragraphs, issues)
    expect(affected).toHaveLength(0)
  })

  it('sorts indices in ascending order', () => {
    const issues = [
      { description: '红菱和敲门声有问题', location: '全文' },
    ]
    const affected = findAffectedParagraphs(paragraphs, issues)
    expect(affected).toEqual([1, 3])
  })
})

describe('mergeParagraphFixes', () => {
  const originalParagraphs = [
    '第一段原文。',
    '第二段原文。',
    '第三段原文。',
    '第四段原文。',
  ]

  it('replaces only affected paragraphs', () => {
    const modifiedParagraphs = [
      { index: 1, content: '第二段已修改。' },
    ]
    const affectedIndices = [1]
    const result = mergeParagraphFixes(originalParagraphs, modifiedParagraphs, affectedIndices)

    expect(result).toContain('第一段原文。')
    expect(result).toContain('第二段已修改。')
    expect(result).toContain('第三段原文。')
    expect(result).toContain('第四段原文。')
  })

  it('keeps original when modified paragraph is not provided', () => {
    const modifiedParagraphs: Array<{ index: number; content: string }> = []
    const affectedIndices = [1]
    const result = mergeParagraphFixes(originalParagraphs, modifiedParagraphs, affectedIndices)

    expect(result).toContain('第二段原文。')
  })

  it('replaces multiple paragraphs', () => {
    const modifiedParagraphs = [
      { index: 1, content: '第二段已修改。' },
      { index: 3, content: '第四段已修改。' },
    ]
    const affectedIndices = [1, 3]
    const result = mergeParagraphFixes(originalParagraphs, modifiedParagraphs, affectedIndices)

    const parts = result.split('\n\n')
    expect(parts[0]).toBe('第一段原文。')
    expect(parts[1]).toBe('第二段已修改。')
    expect(parts[2]).toBe('第三段原文。')
    expect(parts[3]).toBe('第四段已修改。')
  })
})

describe('applyParagraphDiffProtection', () => {
  const original = '第一段。\n\n第二段。\n\n第三段。\n\n第四段。'

  it('allows changes to allowed paragraphs', () => {
    const fixed = '第一段。\n\n第二段已修改。\n\n第三段。\n\n第四段。'
    const allowedIndices = [1]
    const result = applyParagraphDiffProtection(original, fixed, allowedIndices)
    expect(result).toContain('第二段已修改。')
  })

  it('reverts changes to non-allowed paragraphs', () => {
    const fixed = '第一段已修改。\n\n第二段。\n\n第三段已修改。\n\n第四段。'
    const allowedIndices = [1]
    const result = applyParagraphDiffProtection(original, fixed, allowedIndices)

    expect(result).toContain('第一段。')
    expect(result).not.toContain('第一段已修改')
    expect(result).toContain('第三段。')
    expect(result).not.toContain('第三段已修改')
    expect(result).toContain('第二段。')
    expect(result).toContain('第四段。')
  })

  it('returns fixed text when paragraph count changes', () => {
    const fixed = '第一段。\n\n第二段。\n\n第三段。'
    const allowedIndices = [1]
    const result = applyParagraphDiffProtection(original, fixed, allowedIndices)
    expect(result).toBe(fixed)
  })

  it('handles empty allowed indices (reverts all changes)', () => {
    const fixed = '第一段已修改。\n\n第二段已修改。\n\n第三段已修改。\n\n第四段已修改。'
    const allowedIndices: number[] = []
    const result = applyParagraphDiffProtection(original, fixed, allowedIndices)
    expect(result).toBe(original)
  })
})

describe('deduplicateSentences', () => {
  it('removes duplicate sentences', () => {
    const text = '这是一个非常长的话，足够被检测。这是第二句足够长的话。这是一个非常长的话，足够被检测。这是第三句足够长的话。'
    const result = deduplicateSentences(text)
    expect(result).toBe('这是一个非常长的话，足够被检测。这是第二句足够长的话。这是第三句足够长的话。')
  })

  it('keeps first occurrence of duplicate', () => {
    const text = '第一句话的内容非常非常的长。第二句话的内容也非常非常的长。第一句话的内容非常非常的长。第三句话的内容非常非常的长。第二句话的内容也非常非常的长。'
    const result = deduplicateSentences(text)
    expect(result).toBe('第一句话的内容非常非常的长。第二句话的内容也非常非常的长。第三句话的内容非常非常的长。')
  })

  it('ignores short sentences', () => {
    const text = '你好。你好。这是一个很长很长的句子内容。'
    const result = deduplicateSentences(text)
    expect(result).toBe('你好。你好。这是一个很长很长的句子内容。')
  })

  it('handles text without duplicates', () => {
    const text = '这是第一句话的详细内容。这是第二句话的详细内容。这是第三句话的详细内容。'
    const result = deduplicateSentences(text)
    expect(result).toBe('这是第一句话的详细内容。这是第二句话的详细内容。这是第三句话的详细内容。')
  })

  it('handles empty text', () => {
    const result = deduplicateSentences('')
    expect(result).toBe('')
  })

  it('handles text with question and exclamation marks', () => {
    const text = '你今天过得怎么样啊？我今天过得非常好呢！你今天过得怎么样啊？非常感谢你的关心啦！'
    const result = deduplicateSentences(text)
    expect(result).toBe('你今天过得怎么样啊？我今天过得非常好呢！非常感谢你的关心啦！')
  })
})

describe('FixAgent paragraph parsing', () => {
  it('parses paragraph format correctly', async () => {
    class TestableFixAgent extends (await import('../../src/agents/fix.ts')).FixAgent {
      public testParse(content: string): ReturnType<typeof this.parse> {
        return this.parse(content)
      }
    }

    const agent = new TestableFixAgent()
    const content = `【段落 1】
这是修改后的第一段。

【段落 3】
这是修改后的第三段。`

    const result = agent.testParse(content)
    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()

    const modifiedParagraphs = (result.data as { modifiedParagraphs: Array<{ index: number; content: string }> }).modifiedParagraphs
    expect(modifiedParagraphs).toHaveLength(2)
    expect(modifiedParagraphs[0]).toEqual({ index: 1, content: '这是修改后的第一段。' })
    expect(modifiedParagraphs[1]).toEqual({ index: 3, content: '这是修改后的第三段。' })
  })

  it('falls back to full content when no paragraph markers', async () => {
    class TestableFixAgent extends (await import('../../src/agents/fix.ts')).FixAgent {
      public testParse(content: string): ReturnType<typeof this.parse> {
        return this.parse(content)
      }
    }

    const agent = new TestableFixAgent()
    const content = '这是普通的全文内容，没有段落标记。'

    const result = agent.testParse(content)
    expect(result.success).toBe(true)
    expect(result.content).toBe(content)
    expect(result.data).toBeUndefined()
  })
})
