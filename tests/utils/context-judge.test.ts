import { describe, expect, it, vi } from 'vitest'
import type { ModelProvider } from '../../src/model/provider.ts'
import {
  batchJudgeTaskRelevance,
  batchClassifyIssues,
} from '../../src/utils/context-judge.js'

describe('context-judge robustness', () => {
  it('falls back to smaller batches when full batch fails', async () => {
    const expected = [true, false, true]
    const provider = {
      chat: vi.fn(async (_messages: unknown): Promise<string> => {
        const userContent = typeof (_messages as Array<{ role: string; content: string }>)[1]?.content === 'string'
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

    const issues = [
      { id: '1', type: 'consistency' as const, severity: 'error' as const, description: 'desc' },
    ]
    const classifications = await batchClassifyIssues(provider, issues)
    expect(classifications).toHaveLength(1)
    expect(classifications[0].isStructural).toBe(true)
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
})
