import { describe, expect, it, vi } from 'vitest'
import type { ModelProvider } from '../../src/model/provider.ts'
import {
  batchJudgeTaskRelevance,
  generateIssueFingerprint,
  batchValidateTimeAnchors,
} from '../../src/utils/context-judge.js'

describe('context-judge robustness', () => {
  it('maps indexed structured results by id', async () => {
    const provider = {
      chatStructured: vi.fn(async (): Promise<unknown> => ({
        results: [
          { id: 'item_2', value: false },
          { id: 'item_1', value: true },
        ],
      })),
      chat: vi.fn(),
    } as unknown as ModelProvider

    const items = [
      { taskDescription: 'task1', outlineDescription: 'outline' },
      { taskDescription: 'task2', outlineDescription: 'outline' },
    ]
    const relevance = await batchJudgeTaskRelevance(provider, items)
    expect(relevance).toEqual([true, false])
    expect(provider.chatStructured).toHaveBeenCalledTimes(1)
  })

  it('splits large batches before calling the model', async () => {
    const seenBatchSizes: number[] = []
    const provider = {
      chatStructured: vi.fn(
        async (messages: Array<{ role: string; content: string }>): Promise<unknown> => {
          const userContent = messages.find((m) => m.role === 'user')?.content ?? ''
          const ids = Array.from(userContent.matchAll(/ITEM_ID=(item_\d+)/g), (match) => match[1]!)
          seenBatchSizes.push(ids.length)
          return {
            results: ids.map((id) => ({ id, value: true })),
          }
        }
      ),
      chat: vi.fn(),
    } as unknown as ModelProvider

    const items = Array.from({ length: 25 }, (_, index) => ({
      taskDescription: `task${index + 1}`,
      outlineDescription: 'outline',
    }))

    const relevance = await batchJudgeTaskRelevance(provider, items)

    expect(relevance).toEqual(Array.from({ length: 25 }, () => true))
    expect(Math.max(...seenBatchSizes)).toBeLessThan(25)
    expect(seenBatchSizes.reduce((sum, size) => sum + size, 0)).toBe(25)
  })

  it('falls back to smaller batches when full batch fails', async () => {
    const expected = [true, false, true]
    const provider = {
      chat: vi.fn(async (_messages: unknown): Promise<string> => {
        const userContent =
          typeof (_messages as Array<{ role: string; content: string }>)[1]?.content === 'string'
            ? (_messages as Array<{ role: string; content: string }>)[1].content
            : ''
        // Count how many items are in this batch by counting "taskDescription" occurrences.
        const itemCount = (userContent.match(/taskDescription/g) ?? []).length
        if (itemCount === 3) {
          throw new Error('full batch failed')
        }
        if (itemCount === 2) {
          throw new Error('half batch also failed')
        }
        // Single item: determine which task by extracting the task number.
        const match = userContent.match(/task(\d)/)
        const idx = match ? parseInt(match[1], 10) - 1 : 0
        return JSON.stringify({ results: [expected[idx]] })
      }),
    } as unknown as ModelProvider

    const items = [
      { taskDescription: 'task1', outlineDescription: 'outline' },
      { taskDescription: 'task2', outlineDescription: 'outline' },
      { taskDescription: 'task3', outlineDescription: 'outline' },
    ]
    const relevance = await batchJudgeTaskRelevance(provider, items)
    expect(relevance).toEqual([true, false, true])
    expect(provider.chat).toHaveBeenCalledTimes(5) // 1 full[3] + 1 full[2] + 3 singles
  })

  it('uses safe fallback for classification when all calls fail', async () => {
    const provider = {
      chat: vi.fn(async (): Promise<string> => {
        throw new Error('always fails')
      }),
    } as unknown as ModelProvider

    const items = [{ taskDescription: 'task1', outlineDescription: 'outline' }]
    const relevance = await batchJudgeTaskRelevance(provider, items)
    expect(relevance).toEqual([false])
  })

  it('returns full batch result when successful', async () => {
    const provider = {
      chat: vi.fn(async (): Promise<string> => {
        return JSON.stringify({ results: [true, false] })
      }),
    } as unknown as ModelProvider

    const items = [
      { taskDescription: 'task1', outlineDescription: 'outline' },
      { taskDescription: 'task2', outlineDescription: 'outline' },
    ]
    const relevance = await batchJudgeTaskRelevance(provider, items)
    expect(relevance).toEqual([true, false])
    expect(provider.chat).toHaveBeenCalledTimes(1)
  })

  it('generateIssueFingerprint uses structured fields and ignores description', () => {
    const a = {
      id: '1',
      type: 'consistency' as const,
      severity: 'error' as const,
      description: '角色甲不应该出现在这里',
      dimension: 'character',
      subject: '角色甲',
      locationRef: { paragraphIndex: 2, sentenceIndex: 3 },
    }
    const b = {
      id: '2',
      type: 'consistency' as const,
      severity: 'error' as const,
      description: '角色甲出现在了错误的位置',
      dimension: 'character',
      subject: '角色甲',
      locationRef: { paragraphIndex: 2, sentenceIndex: 3 },
    }
    expect(generateIssueFingerprint(a)).toBe(generateIssueFingerprint(b))
    expect(generateIssueFingerprint(a)).not.toContain('角色甲不应该出现在这里')
  })

  it('generateIssueFingerprint falls back to locationRef when subject is missing', () => {
    const issue = {
      id: 'issue-7',
      type: 'consistency' as const,
      severity: 'error' as const,
      description: 'description text',
      locationRef: { paragraphIndex: 1, sentenceIndex: 2 },
    }
    const fp = generateIssueFingerprint(issue)
    expect(fp).toContain('consistency')
    expect(fp).toContain('p1s2')
    expect(fp).not.toContain('description text')
  })

  it('generateIssueFingerprint marks fingerprint generic when no subject or location', () => {
    const issue = {
      id: 'issue-8',
      type: 'hallucination' as const,
      severity: 'error' as const,
      description: 'any text',
    }
    const fp = generateIssueFingerprint(issue)
    expect(fp).toContain('hallucination:unknown:__generic__:')
    expect(fp).not.toContain('issue-8')
  })

  it('generateIssueFingerprint generic branch stays stable across rounds when id changes', () => {
    const a = {
      id: 'round-1-id',
      type: 'consistency' as const,
      severity: 'error' as const,
      description: '同一问题描述',
    }
    const b = {
      id: 'round-2-id',
      type: 'consistency' as const,
      severity: 'error' as const,
      description: '同一问题描述',
    }
    expect(generateIssueFingerprint(a)).toBe(generateIssueFingerprint(b))
  })

  it('generateIssueFingerprint generic branch distinguishes different descriptions', () => {
    const a = {
      id: 'issue-1',
      type: 'consistency' as const,
      severity: 'error' as const,
      description: '问题甲',
    }
    const b = {
      id: 'issue-2',
      type: 'consistency' as const,
      severity: 'error' as const,
      description: '问题乙',
    }
    expect(generateIssueFingerprint(a)).not.toBe(generateIssueFingerprint(b))
  })
})

describe('batchValidateTimeAnchors', () => {
  it('validates against the ending snippet of the previous chapter, not the opening', async () => {
    let capturedUserContent = ''
    const provider = {
      chatStructured: vi.fn(
        async (messages: Array<{ role: string; content: string }>): Promise<unknown> => {
          capturedUserContent = messages.find((m) => m.role === 'user')?.content ?? ''
          return { results: [{ id: 'item_1', value: { valid: true } }] }
        }
      ),
      chat: vi.fn(),
    } as unknown as ModelProvider

    const openingMarker = 'OPENING_MARKER_上一章开头与终态无关'
    const endingMarker = 'ENDING_MARKER_上一章结尾终态事件'
    const previousContent = `${openingMarker}\n\n${'填充段落。'.repeat(400)}\n\n${endingMarker}`

    const results = await batchValidateTimeAnchors(provider, [
      { anchor: '承接上一章结尾', previousContent },
    ])

    expect(results).toEqual([{ valid: true }])
    expect(capturedUserContent).toContain(endingMarker)
    expect(capturedUserContent).not.toContain(openingMarker)
  })
})
