import { describe, expect, it, vi } from 'vitest'
import type { ModelProvider } from '../../src/model/provider.ts'

function createMockProvider(chatResponse?: string): ModelProvider {
  return {
    chat: vi.fn().mockResolvedValue(chatResponse ?? ''),
    chatStructured: vi.fn().mockResolvedValue({}),
  }
}

class TestableWorldbuilderAgent
  extends (await import('../../src/agents/worldbuilder.ts')).WorldbuilderAgent
{
  public exposeParse(content: string) {
    return this.parse(content)
  }
}

describe('WorldbuilderAgent parse', () => {
  it('returns success:true with fallback when AI returns garbage with no JSON', () => {
    const agent = new TestableWorldbuilderAgent(createMockProvider())
    const result = agent.exposeParse('我不是洗衣精')
    expect(result.success).toBe(true)
    expect((result.data as { world?: string }).world).toBe('我不是洗衣精')
  })

  it('returns success:true with repaired JSON when JSON is malformed', () => {
    const agent = new TestableWorldbuilderAgent(createMockProvider())
    const result = agent.exposeParse('{"title": "测试", world: "内容"}')
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ title: '测试', world: '内容' })
  })

  it('returns success:true with data when JSON is valid', () => {
    const agent = new TestableWorldbuilderAgent(createMockProvider())
    const result = agent.exposeParse('{"title": "测试书名", "world": "世界观内容"}')
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ title: '测试书名', world: '世界观内容' })
  })

  it('extracts valid JSON from surrounding text', () => {
    const agent = new TestableWorldbuilderAgent(createMockProvider())
    const result = agent.exposeParse('以下是世界观设定：\n{"title": "书名", "world": "内容"}\n结束')
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ title: '书名', world: '内容' })
  })

  it('falls back to using markdown prose as world content', () => {
    const agent = new TestableWorldbuilderAgent(createMockProvider())
    const result = agent.exposeParse('# 世界观设定文档\n\n## 背景\n民国北平...')
    expect(result.success).toBe(true)
    expect((result.data as { world?: string }).world).toContain('民国北平')
  })

  it('returns success:false for empty AI output', () => {
    const agent = new TestableWorldbuilderAgent(createMockProvider())
    const result = agent.exposeParse('')
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
})
