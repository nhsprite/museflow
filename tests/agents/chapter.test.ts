import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, ModelProvider } from '../../src/model/provider.ts'
import type { AgentState } from '../../src/agents/base.ts'

const mockChat = vi.fn(async (): Promise<string> => '')

vi.mock('../../src/model/registry.ts', () => ({
  createProvider: (): ModelProvider => ({
    chat: mockChat,
  }),
}))

class TestableChapterAgent extends (await import('../../src/agents/chapter.ts')).ChapterAgent {
  public exposePrompt(state: Required<AgentState>): Message[] {
    return this.buildPrompt(state)
  }
}

describe('ChapterAgent chapter numbering', () => {
  beforeEach(() => {
    mockChat.mockClear()
  })

  it('builds the first chapter prompt with display numbering', () => {
    const agent = new TestableChapterAgent()

    const messages = agent.exposePrompt({
      idea: '一个少年踏上修仙路',
      genre: 'xianxia',
      totalChapters: 3,
      world: '玄元界',
      characters: '【林玄】少年',
      outline: '第1章：破庙惊梦\n少年在破庙中醒来',
      previousChapters: '',
      chapterContent: '',
      chapterIndex: 0,
      foreshadowStack: '',
      chapterSummaries: [],
    })

    expect(messages[1]?.content).toContain('请撰写第 1 章的正文内容。')
    expect(messages[1]?.content).toContain('=== PRE_WRITE_CHECK ===')
    expect(messages[1]?.content).toContain('=== CHAPTER_CONTENT ===')
    expect(messages[1]?.content).toContain('破庙惊梦')
    expect(messages[1]?.content).not.toContain('第 0 章')
  })
})
