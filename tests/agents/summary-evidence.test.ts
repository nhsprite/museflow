import { describe, expect, it } from 'vitest'
import { processSummaryOutput } from '../../src/agents/summary.ts'

describe('processSummaryOutput evidence validation', () => {
  it('keeps high confidence when evidence quote exists in chapter content', () => {
    const output = {
      success: true as const,
      content: '',
      data: {
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: { '密信': '官府仓库' },
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          canonicalFacts: [
            {
              subject: '密信',
              attribute: '所在位置',
              value: '官府仓库',
              establishedIn: 0,
              confidence: 'high',
              source: 'chapter_text',
              evidence: {
                chapterIndex: 0,
                quote: '密信已被秘密转移至官府仓库',
              },
            },
          ],
        },
      },
    }

    const chapterContent = '当夜，密信已被秘密转移至官府仓库，由专人看守。'
    const result = processSummaryOutput(output, 0, [], undefined, chapterContent)
    const fact = result?.storyState?.canonicalFacts?.[0]
    expect(fact?.confidence).toBe('high')
    expect(fact?.evidence?.quote).toBe('密信已被秘密转移至官府仓库')
  })

  it('downgrades confidence and drops evidence when quote is not found', () => {
    const output = {
      success: true as const,
      content: '',
      data: {
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: { '密信': '官府仓库' },
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          canonicalFacts: [
            {
              subject: '密信',
              attribute: '所在位置',
              value: '官府仓库',
              establishedIn: 0,
              confidence: 'high',
              source: 'chapter_text',
              evidence: {
                chapterIndex: 0,
                quote: '密信飞到了火星基地',
              },
            },
          ],
        },
      },
    }

    const chapterContent = '当夜，密信已被秘密转移至官府仓库，由专人看守。'
    const result = processSummaryOutput(output, 0, [], undefined, chapterContent)
    const fact = result?.storyState?.canonicalFacts?.[0]
    expect(fact?.confidence).toBe('low')
    expect(fact?.evidence).toBeUndefined()
  })
})
