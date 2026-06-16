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

class TestableChapterPlannerAgent extends (await import('../../src/agents/chapter-planner.ts')).ChapterPlannerAgent {
  public exposePrompt(state: Required<AgentState>): Message[] {
    return this.buildPrompt(state)
  }
}

describe('ChapterPlannerAgent issues integration', () => {
  beforeEach(() => {
    mockChat.mockClear()
  })

  it('does not include issues section when no issues are provided', () => {
    const agent = new TestableChapterPlannerAgent()

    const messages = agent.exposePrompt({
      idea: '一个少年踏上修仙路',
      genre: 'xianxia',
      totalChapters: 3,
      world: '玄元界',
      characters: '【林玄】少年',
      outline: '第1章：破庙惊梦\n少年在破庙中醒来',
      previousChapters: '',
      chapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).not.toContain('上轮问题反馈')
    expect(userMessage).not.toContain('必须在本次规划中修复')
  })

  it('includes issues section when issues are provided', () => {
    const agent = new TestableChapterPlannerAgent()

    const issues: Issue[] = [
      {
        id: 'issue-1',
        type: 'outline_violation',
        severity: 'error',
        description: '缺少大纲要求的情节点：地铁规划公布',
      },
      {
        id: 'issue-2',
        type: 'outline_deviation',
        severity: 'error',
        description: '大纲中的关键台词在正文中完全没有出现',
        location: '第三段',
        suggestion: '将关键台词补回第三段并保持原文措辞',
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
      chapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
      issues,
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('上轮问题反馈')
    expect(userMessage).toContain('必须在本次规划中修复')
    expect(userMessage).toContain('[outline_violation] 缺少大纲要求的情节点：地铁规划公布')
    expect(userMessage).toContain('[outline_deviation] 大纲中的关键台词在正文中完全没有出现')
    expect(userMessage).toContain('位置: 第三段')
    expect(userMessage).toContain('建议: 将关键台词补回第三段并保持原文措辞')
    expect(userMessage).toContain('每个遗漏的大纲情节点都在 sections 中明确体现')
    expect(userMessage).toContain('每个未落实的要求都在 outlineCheck 中标记为 fulfilled')
  })

  it('formats multiple issues with correct numbering', () => {
    const agent = new TestableChapterPlannerAgent()

    const issues: Issue[] = [
      {
        id: 'issue-1',
        type: 'outline_violation',
        severity: 'error',
        description: '问题 A',
      },
      {
        id: 'issue-2',
        type: 'outline_violation',
        severity: 'error',
        description: '问题 B',
      },
      {
        id: 'issue-3',
        type: 'timeline_mismatch',
        severity: 'error',
        description: '问题 C',
      },
    ]

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 1,
      world: '',
      characters: '',
      outline: '第1章：测试',
      previousChapters: '',
      chapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
      issues,
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('1. [outline_violation] 问题 A')
    expect(userMessage).toContain('2. [outline_violation] 问题 B')
    expect(userMessage).toContain('3. [timeline_mismatch] 问题 C')
  })

  it('forbids inventing new facts to reconcile prior-chapter contradictions', () => {
    const agent = new TestableChapterPlannerAgent()

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '',
      outline: '第2章：追查真相\n主角继续调查上一章遗留的问题',
      previousChapters: '前文摘要中存在两个地点来源记录不一致。',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: [],
      issues: [{
        id: 'issue-1',
        type: 'consistency',
        severity: 'error',
        description: '前文设定存在互相冲突的来源记录',
      }],
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('不得为了修补前文矛盾而发明新事实')
    expect(userMessage).toContain('不得让角色说出其未在前文获得的信息')
  })
})
