import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, ModelProvider } from '../../src/model/provider.ts'
import type { AgentState } from '../../src/agents/base.ts'

const mockChat = vi.fn(async (): Promise<string> => '')

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
