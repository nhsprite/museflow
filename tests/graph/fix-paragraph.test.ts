import { describe, expect, it, vi } from 'vitest'
import {
  splitIntoParagraphs,
  findAffectedParagraphs,
  extractLocationInfo,
  mergeParagraphFixes,
  applyParagraphDiffProtection,
} from '../../src/graph/utils/text-patching.js'
import type { Message, ModelProvider } from '../../src/model/provider.ts'

function createMockProvider(chatResponse?: string): ModelProvider {
  return {
    chat: vi.fn().mockResolvedValue(chatResponse ?? ''),
    chatStructured: vi.fn().mockResolvedValue({}),
  }
}

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

describe('findAffectedParagraphs', () => {
  const paragraphs = [
    '沈惊鸿走在青石板路上。',
    '一阵急促的敲门声将他从梦中唤醒。',
    '他打开房门，看到一位红衣女子。',
    '女子自称红菱，来自远方的绣坊。',
  ]

  it('finds paragraphs by structured locationRef', () => {
    const issues = [{ description: '"红衣女子"应该改为"红菱"', locationRef: { paragraphIndex: 2 } }]
    const affected = findAffectedParagraphs(paragraphs, issues)
    expect(affected).toContain(2)
    expect(affected).not.toContain(3)
  })

  it('ignores natural-language location text', () => {
    const issues = [{ description: '"红衣女子"应该改为"红菱"', location: '第三段' }]
    const affected = findAffectedParagraphs(paragraphs, issues)
    expect(affected).toEqual([])
  })

  it('does not guess paragraphs from issue prose when no explicit location is given', () => {
    const issues = [{ description: '"红衣女子"应该改为"红菱"' }]
    const affected = findAffectedParagraphs(paragraphs, issues)
    expect(affected).toEqual([])
  })

  it('does not use prose-only full-text locations as paragraph targets', () => {
    const issues = [{ description: '沈惊鸿的名字写错了', location: '全文' }]
    const affected = findAffectedParagraphs(paragraphs, issues)
    expect(affected).toEqual([])
  })

  it('returns empty array when no matches', () => {
    const issues = [{ description: '"不存在的句子"有问题', location: '某段' }]
    const affected = findAffectedParagraphs(paragraphs, issues)
    expect(affected).toHaveLength(0)
  })

  it('sorts explicit indices in ascending order', () => {
    const issues = [
      { description: '一个段落有问题', locationRef: { paragraphIndex: 3 } },
      { description: '另一个段落有问题', locationRef: { paragraphIndex: 1 } },
    ]
    const affected = findAffectedParagraphs(paragraphs, issues)
    expect(affected).toEqual([1, 3])
  })

  it('does not parse compound Chinese numeral paragraph locations', () => {
    const issues = [{ description: '第十二段语气生硬', location: '第十二段' }]

    const manyParagraphs = Array.from({ length: 25 }, (_, i) => `第${i + 1}段内容。`)
    const affected = findAffectedParagraphs(manyParagraphs, issues)
    expect(affected).toEqual([])
  })
})

describe('extractLocationInfo', () => {
  it('reads structured locationRef only', () => {
    const paragraphLoc = extractLocationInfo({
      description: '第十二段语气生硬',
      locationRef: { paragraphIndex: 11 },
    })
    expect(paragraphLoc).toContainEqual({ paragraphIndex: 11 })

    const sentenceLoc = extractLocationInfo({
      description: '第二十三句重复',
      locationRef: { sentenceIndex: 22 },
    })
    expect(sentenceLoc).toContainEqual({ sentenceIndex: 22 })
  })

  it('ignores prose-only descriptions', () => {
    expect(extractLocationInfo({ description: '第十二段语气生硬' })).toEqual([])
    expect(extractLocationInfo({ description: '第二十三句重复' })).toEqual([])
  })
})

describe('mergeParagraphFixes', () => {
  const originalParagraphs = ['第一段原文。', '第二段原文。', '第三段原文。', '第四段原文。']

  it('replaces only affected paragraphs', () => {
    const modifiedParagraphs = [{ index: 1, content: '第二段已修改。' }]
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

describe('FixAgent paragraph parsing', () => {
  it('parses paragraph format correctly', async () => {
    class TestableFixAgent extends (await import('../../src/agents/fix.ts')).FixAgent {
      public testParse(content: string): ReturnType<typeof this.parse> {
        return this.parse(content)
      }
    }

    const agent = new TestableFixAgent(createMockProvider())
    const content = `【段落 1】
这是修改后的第一段。

【段落 3】
这是修改后的第三段。`

    const result = agent.testParse(content)
    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()

    const modifiedParagraphs = (
      result.data as { modifiedParagraphs: Array<{ index: number; content: string }> }
    ).modifiedParagraphs
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

    const agent = new TestableFixAgent(createMockProvider())
    const content = '这是普通的全文内容，没有段落标记。'

    const result = agent.testParse(content)
    expect(result.success).toBe(true)
    expect(result.content).toBe(content)
    expect(result.data).toBeUndefined()
  })
})
