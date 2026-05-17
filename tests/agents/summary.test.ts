import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, ModelProvider } from '../../src/model/provider.ts'
import type { AgentState } from '../../src/agents/base.ts'

const mockChat = vi.fn(async (): Promise<string> => '')

vi.mock('../../src/model/registry.ts', () => ({
  createProvider: (): ModelProvider => ({
    chat: mockChat,
  }),
}))

class TestableSummaryAgent extends (await import('../../src/agents/summary.ts')).SummaryAgent {
  public exposePrompt(state: Required<AgentState>): Message[] {
    return this.buildPrompt(state)
  }
}

describe('SummaryAgent prompt', () => {
  beforeEach(() => {
    mockChat.mockClear()
  })

  it('includes chapter content in the prompt', () => {
    const agent = new TestableSummaryAgent()
    const chapterContent = '顾承舟站在办公室窗前，看着窗外的城市夜景。电话响了，是苏晚棠打来的。'

    const messages = agent.exposePrompt({
      idea: '一个关于复仇与救赎的故事',
      genre: 'urban',
      totalChapters: 40,
      chapterContent,
      chapterTitle: '夜幕降临',
      chapterIndex: 32,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    const userMessage = messages.find(m => m.role === 'user')?.content ?? ''
    expect(userMessage).toContain(chapterContent)
    expect(userMessage).toContain('章节内容：')
  })

  it('includes chapter title and index in the prompt', () => {
    const agent = new TestableSummaryAgent()

    const messages = agent.exposePrompt({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterContent: 'test content',
      chapterTitle: 'Test Title',
      chapterIndex: 5,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    const userMessage = messages.find(m => m.role === 'user')?.content ?? ''
    expect(userMessage).toContain('章节标题：Test Title')
    expect(userMessage).toContain('章节序号：第6章')
  })

  it('shows empty content placeholder when chapterContent is undefined', () => {
    const agent = new TestableSummaryAgent()

    const messages = agent.exposePrompt({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterContent: undefined as unknown as string,
      chapterTitle: undefined,
      chapterIndex: undefined,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    const userMessage = messages.find(m => m.role === 'user')?.content ?? ''
    expect(userMessage).toContain('（无内容）')
    expect(userMessage).toContain('章节标题：未知')
    expect(userMessage).toContain('章节序号：未知')
  })
})
