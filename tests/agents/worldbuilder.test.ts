import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProvider } from '../../src/model/provider.ts'

const mockChat = vi.fn(async (): Promise<string> => '')

vi.mock('../../src/model/registry.ts', () => ({
  createProvider: (): ModelProvider => ({
    chat: mockChat,
  }),
}))

class TestableWorldbuilderAgent extends (await import('../../src/agents/worldbuilder.ts')).WorldbuilderAgent {
  public exposeParse(content: string) {
    return this.parse(content)
  }
}

describe('WorldbuilderAgent parse', () => {
  beforeEach(() => {
    mockChat.mockClear()
  })

  it('returns success:false when AI returns garbage with no JSON', () => {
    const agent = new TestableWorldbuilderAgent()
    const result = agent.exposeParse('我不是洗衣精')
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns success:false when JSON is malformed', () => {
    const agent = new TestableWorldbuilderAgent()
    const result = agent.exposeParse('{"title": "测试", world: "内容"}')
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns success:true with data when JSON is valid', () => {
    const agent = new TestableWorldbuilderAgent()
    const result = agent.exposeParse('{"title": "测试书名", "world": "世界观内容"}')
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ title: '测试书名', world: '世界观内容' })
  })

  it('extracts valid JSON from surrounding text', () => {
    const agent = new TestableWorldbuilderAgent()
    const result = agent.exposeParse('以下是世界观设定：\n{"title": "书名", "world": "内容"}\n结束')
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ title: '书名', world: '内容' })
  })
})
