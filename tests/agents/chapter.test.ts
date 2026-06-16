import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, ModelProvider } from '../../src/model/provider.ts'
import type { AgentState } from '../../src/agents/base.ts'
import type { Issue } from '../../src/types/agent.ts'

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
      foreshadowStack: [],
      chapterSummaries: [],
    })

    expect(messages[1]?.content).toContain('请撰写第 1 章的正文内容。')
    expect(messages[1]?.content).toContain('=== PRE_WRITE_CHECK ===')
    expect(messages[1]?.content).toContain('=== CHAPTER_CONTENT ===')
    expect(messages[1]?.content).toContain('破庙惊梦')
    expect(messages[1]?.content).not.toContain('第 0 章')
  })

  it('includes issue suggestions in rewrite prompts', () => {
    const agent = new TestableChapterAgent()

    const issues: Issue[] = [
      {
        id: 'issue-1',
        type: 'consistency',
        severity: 'error',
        description: '六耳猕猴结局与大纲冲突',
        location: '章节结尾',
        suggestion: '保持六耳猕猴伏法，不要改写为皈依入队',
      },
    ]

    const messages = agent.exposePrompt({
      idea: '一个少年踏上修仙路',
      genre: 'xianxia',
      totalChapters: 3,
      world: '玄元界',
      characters: '【林玄】少年',
      outline: '第1章：破庙惊梦\n少年在破庙中醒来',
      previousChapters: '',
      chapterContent: '已有正文',
      chapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
      issues,
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('[consistency] 六耳猕猴结局与大纲冲突')
    expect(userMessage).toContain('位置: 章节结尾')
    expect(userMessage).toContain('建议: 保持六耳猕猴伏法，不要改写为皈依入队')
  })

  it('includes canonical fact verification section when storyState is provided', () => {
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
      foreshadowStack: [],
      chapterSummaries: [],
      storyState: '【角色位置】\n林玄：破庙\n\n【角色状态】\n林玄：受伤\n\n【关键物品】\n通灵宝玉：女娲补天遗石\n\n【已揭示的秘密】\n通灵宝玉与石猴同出青埂峰\n\n【已被覆盖的旧事实】\n林玄原名林二',
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('<canonical_facts>')
    expect(userMessage).toContain('【角色位置】')
    expect(userMessage).toContain('林玄：破庙')
    expect(userMessage).toContain('【角色状态】')
    expect(userMessage).toContain('林玄：受伤')
    expect(userMessage).toContain('【关键物品】')
    expect(userMessage).toContain('通灵宝玉：女娲补天遗石')
    expect(userMessage).toContain('【已揭示的秘密】')
    expect(userMessage).toContain('通灵宝玉与石猴同出青埂峰')
    expect(userMessage).toContain('【已被覆盖的旧事实】')
    expect(userMessage).toContain('林玄原名林二')
    expect(userMessage).toContain('事实核查')
    expect(userMessage).toContain('严禁 invent 新的事实')
  })

  it('omits canonical fact section when storyState is empty', () => {
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
      foreshadowStack: [],
      chapterSummaries: [],
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).not.toContain('<canonical_facts>')
  })
})