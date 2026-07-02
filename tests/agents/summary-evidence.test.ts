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

  it('accepts fuzzy evidence match with medium confidence cap', () => {
    const output = {
      success: true as const,
      content: '',
      data: {
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: { '油纸包': '枕头下' },
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          canonicalFacts: [
            {
              subject: '油纸包',
              attribute: '位置',
              value: '枕头下',
              establishedIn: 0,
              confidence: 'high',
              source: 'chapter_text',
              evidence: {
                chapterIndex: 0,
                quote: '他将油纸包小心地藏在了枕头下面',
              },
            },
          ],
        },
      },
    }

    // 正文不包含 quote 开头的主语"他"，但 quote 的绝大部分（15/16）以连续子串出现在正文中，应触发模糊匹配。
    const chapterContent = '他吹熄了油灯，将油纸包小心地藏在了枕头下面，又掖了掖被角。'
    const result = processSummaryOutput(output, 0, [], undefined, chapterContent)
    const fact = result?.storyState?.canonicalFacts?.[0]
    expect(fact?.confidence).toBe('medium')
    expect(fact?.evidence).toBeDefined()
    expect(fact?.evidence?.quote).toBe('他将油纸包小心地藏在了枕头下面')
  })

  it('keeps low confidence facts unchanged on fuzzy match', () => {
    const output = {
      success: true as const,
      content: '',
      data: {
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: {},
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          canonicalFacts: [
            {
              subject: '沈砚秋',
              attribute: '计划',
              value: '赴文会',
              establishedIn: 0,
              confidence: 'low',
              source: 'chapter_text',
              evidence: {
                chapterIndex: 0,
                quote: '他打算明日一早就去赴那场琉璃厂文会',
              },
            },
          ],
        },
      },
    }

    const chapterContent = '他打算明日一早就去赴那场琉璃厂的文会。'
    const result = processSummaryOutput(output, 0, [], undefined, chapterContent)
    const fact = result?.storyState?.canonicalFacts?.[0]
    expect(fact?.confidence).toBe('low')
    expect(fact?.evidence).toBeDefined()
  })
})
