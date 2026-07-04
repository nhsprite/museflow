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
          keyItemsLocation: { 密信: '官府仓库' },
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

  it('keeps structurally valid chapter_text facts without prose quote verification', () => {
    const output = {
      success: true as const,
      content: '',
      data: {
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: { 密信: '官府仓库' },
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
    expect(fact?.confidence).toBe('high')
    expect(fact?.evidence?.quote).toBe('密信飞到了火星基地')
  })

  it('preserves declared confidence without fuzzy evidence matching', () => {
    const output = {
      success: true as const,
      content: '',
      data: {
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: { 油纸包: '枕头下' },
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

    const chapterContent = '他吹熄了油灯，将油纸包小心地藏在了枕头下面，又掖了掖被角。'
    const result = processSummaryOutput(output, 0, [], undefined, chapterContent)
    const fact = result?.storyState?.canonicalFacts?.[0]
    expect(fact?.confidence).toBe('high')
    expect(fact?.evidence).toBeDefined()
    expect(fact?.evidence?.quote).toBe('他将油纸包小心地藏在了枕头下面')
  })

  it('drops low confidence chapter_text facts from hard canonical facts even when evidence fuzzy matches', () => {
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
    expect(result?.storyState?.canonicalFacts).toEqual([])
  })

  it('keeps subjects without prose-character filtering', () => {
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
              subject: '密信，官府仓库',
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
    expect(result?.storyState?.canonicalFacts).toHaveLength(1)
    expect(result?.storyState?.canonicalFacts?.[0]).toMatchObject({
      subject: '密信，官府仓库',
      attribute: '所在位置',
      value: '官府仓库',
    })
  })

  it('drops chapter_text facts with attributes outside the structured enum', () => {
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
              subject: '密信',
              attribute: '不支持的字段',
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
    expect(result?.storyState?.canonicalFacts).toEqual([])
  })

  it('keeps subjects that embed the fact value without prose-fragment filtering', () => {
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
              subject: '关键文件持有者专人',
              attribute: '持有者',
              value: '专人',
              establishedIn: 0,
              confidence: 'high',
              source: 'chapter_text',
              evidence: {
                chapterIndex: 0,
                quote: '关键文件由专人看守',
              },
            },
          ],
        },
      },
    }

    const chapterContent = '当夜，关键文件由专人看守。'
    const result = processSummaryOutput(output, 0, [], undefined, chapterContent)
    expect(result?.storyState?.canonicalFacts).toHaveLength(1)
    expect(result?.storyState?.canonicalFacts?.[0]).toMatchObject({
      subject: '关键文件持有者专人',
      attribute: '持有者',
      value: '专人',
    })
  })

  it('keeps structurally valid subjects that contain relation marker characters', () => {
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
              subject: '向阳档案馆分馆',
              attribute: '身份',
              value: '档案机构',
              establishedIn: 0,
              confidence: 'high',
              source: 'chapter_text',
              evidence: {
                chapterIndex: 0,
                quote: '向阳档案馆分馆是本城保管旧档的档案机构',
              },
            },
          ],
        },
      },
    }

    const chapterContent = '向阳档案馆分馆是本城保管旧档的档案机构。'
    const result = processSummaryOutput(output, 0, [], undefined, chapterContent)
    expect(result?.storyState?.canonicalFacts).toHaveLength(1)
    expect(result?.storyState?.canonicalFacts?.[0]).toMatchObject({
      subject: '向阳档案馆分馆',
      attribute: '身份',
      value: '档案机构',
    })
  })

  it('keeps reconciliation canonical facts without chapter evidence', () => {
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
              subject: '密信',
              attribute: '所在位置',
              value: '官府仓库',
              establishedIn: 0,
              confidence: 'medium',
              source: 'reconciliation',
            },
          ],
        },
      },
    }

    const chapterContent = '当夜，众人只提到仓库由专人看守。'
    const result = processSummaryOutput(output, 0, [], undefined, chapterContent)
    expect(result?.storyState?.canonicalFacts).toHaveLength(1)
    expect(result?.storyState?.canonicalFacts?.[0]).toMatchObject({
      subject: '密信',
      attribute: '所在位置',
      value: '官府仓库',
      source: 'reconciliation',
    })
  })
})
