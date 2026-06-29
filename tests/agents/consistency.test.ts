import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, ModelProvider } from '../../src/model/provider.ts'
import type { AgentState } from '../../src/agents/base.ts'
import type { CanonicalFact } from '../../src/types/story-state.ts'

const mockChat = vi.fn(async (): Promise<string> => JSON.stringify({ results: [false] }))

vi.mock('../../src/model/registry.ts', () => ({
  createProvider: (): ModelProvider => ({
    chat: mockChat,
  }),
}))

class TestableConsistencyAgent extends (await import('../../src/agents/consistency.ts')).ConsistencyAgent {
  public exposePrompt(state: Required<AgentState>): Message[] {
    return this.buildPrompt(state)
  }
}

describe('ConsistencyAgent time anchor', () => {
  beforeEach(() => {
    mockChat.mockClear()
  })

  it('uses chapterTimeAnchor as the time origin when provided', () => {
    const agent = new TestableConsistencyAgent()

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【苏半城】主角',
      outline: '第2章：茶楼暗访\n三日期限内展开调查',
      chapterContent: '三日期限第一日，主角开始调查。',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: ['第1章：主角会见亲王，获三日期限。'],
      storyState: '【上一章结束时间】\n出殡后第三日午时',
      chapterPlan: {
        sections: [],
        timeline: [],
        outlineCheck: [],
        chapterTimeAnchor: '三日期限第一日卯时（回溯覆盖第5章后三日）',
      },
      chapterTimeAnchor: '三日期限第一日卯时（回溯覆盖第5章后三日）',
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('本章时间锚点')
    expect(userMessage).toContain('三日期限第一日卯时')
    expect(userMessage).toContain('上一章结束时间')
    expect(userMessage).toContain('以本章时间锚点作为判断时间推进是否合理的依据')
  })
})

describe('ConsistencyAgent outline-authorized facts', () => {
  beforeEach(() => {
    mockChat.mockClear()
  })

  it('includes outline-authorized facts in prompt', () => {
    const agent = new TestableConsistencyAgent()
    const canonicalFacts: CanonicalFact[] = [
      { id: 'f1', subject: '主角', attribute: '所在位置', value: '废弃仓库', establishedIn: 2, source: 'outline' },
      { id: 'f2', subject: '密信', attribute: '来源', value: '旧友暗中递送', establishedIn: 2, source: 'outline' },
    ]

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【主角】',
      outline: '第2章：接头',
      chapterContent: '主角在废弃仓库收到旧友暗中递送的密信。',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: ['第1章：主角离家。'],
      storyState: '【上一章结束时间】\n故事时间第一日',
      canonicalFacts,
      chapterTimeAnchor: '故事时间第二日',
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('本章大纲已授权的新事实')
    expect(userMessage).toContain('废弃仓库')
    expect(userMessage).toContain('旧友暗中递送')
  })
})

describe('ConsistencyAgent canonical facts authority', () => {
  beforeEach(() => {
    mockChat.mockClear()
  })

  it('uses story_state as the single factual authority', () => {
    const agent = new TestableConsistencyAgent()

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【主角】',
      outline: '第2章：接头',
      chapterContent: '主角在废弃仓库收到密信。',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: ['第1章：主角离家。'],
      storyState: '【权威事实】\n- [主角] 所在位置: 城东茶楼\n- [密信] 来源: 旧友暗中递送',
      chapterTimeAnchor: '故事时间第二日',
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('【权威事实 - 一致性检查的唯一事实依据】')
    expect(userMessage).not.toContain('<chapter_summaries>')
    expect(userMessage).not.toContain('<timeline>')
    expect(userMessage).not.toContain('前几章摘要')
  })

  it('emphasizes that canonical facts override old summaries', () => {
    const agent = new TestableConsistencyAgent()

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【主角】',
      outline: '第2章：接头',
      chapterContent: '主角在废弃仓库收到密信。',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: ['第1章：主角离家。'],
      storyState: '【权威事实】\n- [主角] 所在位置: 城东茶楼',
      chapterTimeAnchor: '故事时间第二日',
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('一致性检查必须以本区域中的【权威事实】和【已被覆盖的旧事实】为准')
    expect(userMessage).toContain('如果本章内容与【权威事实】中的当前有效值一致，即使与旧摘要或旧时间线中的旧值不同，也不构成矛盾')
  })
})
