import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, ModelProvider } from '../../src/model/provider.ts'
import type { ChapterPlannerAgentInput, ChapterPlan } from '../../src/agents/types.ts'
import type { Issue } from '../../src/types/agent.ts'
import type { ChapterPlannerAgent } from '../../src/agents/chapter-planner.ts'

const mockChat = vi.fn(async (): Promise<string> => '')

function createMockProvider(): ModelProvider {
  return {
    chat: mockChat,
    chatStructured: vi.fn().mockResolvedValue({}),
  }
}

class TestableChapterPlannerAgent
  extends (await import('../../src/agents/chapter-planner.ts')).ChapterPlannerAgent
{
  public exposePrompt(state: Required<ChapterPlannerAgentInput>): Message[] {
    return this.buildPrompt(state)
  }

  public parseOutput(content: string): ReturnType<ChapterPlannerAgent['parse']> {
    return this.parse(content)
  }
}

describe('ChapterPlannerAgent issues integration', () => {
  beforeEach(() => {
    mockChat.mockClear()
  })

  it('does not include issues section when no issues are provided', () => {
    const agent = new TestableChapterPlannerAgent(createMockProvider())

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
    const agent = new TestableChapterPlannerAgent(createMockProvider())

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
    const agent = new TestableChapterPlannerAgent(createMockProvider())

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
    const agent = new TestableChapterPlannerAgent(createMockProvider())

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
      issues: [
        {
          id: 'issue-1',
          type: 'consistency',
          severity: 'error',
          description: '前文设定存在互相冲突的来源记录',
        },
      ],
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('不得为了修补前文矛盾而发明新事实')
    expect(userMessage).toContain('不得让角色说出其未在前文获得的信息')
  })

  it('includes storyState and time anchor guidance when provided', () => {
    const agent = new TestableChapterPlannerAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '',
      outline: '第2章：追查真相\n主角继续调查上一章遗留的问题',
      previousChapters: '第1章：主角发现线索。',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: [],
      storyState: '【故事时间】\n第三天傍晚',
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('【上一章结束时间】')
    expect(userMessage).toContain('第三天傍晚')
    expect(userMessage).toContain('chapterTimeAnchor')
    expect(userMessage).toContain('本章时间锚点')
  })

  it('includes core-event priority and pending-task deadline conflict rules', () => {
    const agent = new TestableChapterPlannerAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '',
      outline: '第2章：追查真相\n主角继续调查上一章遗留的问题',
      previousChapters: '第1章：主角发现线索。',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('核心事件必须占据本章总字数的 50% 以上')
    expect(userMessage).toContain('硬性优先级')
    expect(userMessage).toContain('当核心事件与前章遗留差事、Deadline 到期事项发生冲突时')
    expect(userMessage).toContain('与核心事件无关的 pending task，即使 deadline 落在本章')
    expect(userMessage).toContain('必须选择 postponed 或一句话带过')
  })

  it('includes closing phase section near the end of the story', () => {
    const agent = new TestableChapterPlannerAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 20,
      world: '',
      characters: '',
      outline: '第18章：追查真相\n主角继续调查上一章遗留的问题',
      previousChapters: '第1章：主角发现线索。',
      chapterIndex: 17,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('【全书收尾阶段】')
    expect(userMessage).toContain('禁止规划任何专门用于铺垫后续章节')
    expect(userMessage).toContain('必须向最终高潮/结局推进')
  })

  it('does not include closing phase section early in the story', () => {
    const agent = new TestableChapterPlannerAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 20,
      world: '',
      characters: '',
      outline: '第2章：追查真相\n主角继续调查上一章遗留的问题',
      previousChapters: '第1章：主角发现线索。',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).not.toContain('【全书收尾阶段】')
  })

  it('includes verified constraints section when constraints are provided', () => {
    const agent = new TestableChapterPlannerAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '',
      outline: '第2章：追查真相\n主角继续调查上一章遗留的问题',
      previousChapters: '第1章：主角发现线索。',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: [],
      verifiedConstraints: ['[consistency] 三日期限是向亲王请得，不是主角主动设定'],
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('已验证约束')
    expect(userMessage).toContain('三日期限是向亲王请得')
    expect(userMessage).toContain('不得推翻、改写或重新引入已被消除的矛盾')
  })

  it('parses chapterTimeAnchor from planner JSON output', async () => {
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        sections: [
          {
            title: '开头',
            summary: '主角醒来',
            wordCount: 500,
            events: ['主角醒来'],
            characters: ['主角'],
            timeMark: '三日后',
          },
        ],
        timeline: [{ event: '主角醒来', time: '三日后', notes: '' }],
        outlineCheck: [{ requirement: '主角醒来', fulfilled: true, section: '开头' }],
        chapterTimeAnchor: '三日后（跨越三日）',
      })
    )

    const agent = new TestableChapterPlannerAgent(createMockProvider())
    const output = await agent.run({
      idea: '测试',
      genre: 'default',
      totalChapters: 1,
      outline: '第1章：主角醒来',
      previousChapters: '',
      chapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    expect(output.success).toBe(true)
    const data = output.data as ChapterPlan
    expect(data.chapterTimeAnchor).toBe('三日后（跨越三日）')
    expect(data.expectedEvents).toBeDefined()
    expect(data.claimedBeatIds).toBeDefined()
  })

  it('parses expectedEvents and structured declaration arrays from planner JSON output', async () => {
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        sections: [
          {
            title: '开头',
            summary: '主角醒来',
            wordCount: 500,
            events: ['主角醒来'],
            characters: ['主角'],
            timeMark: '三日后',
          },
        ],
        timeline: [{ event: '主角醒来', time: '三日后', notes: '' }],
        outlineCheck: [{ requirement: '主角醒来', fulfilled: true, section: '开头' }],
        chapterTimeAnchor: '三日后（跨越三日）',
        expectedEvents: [
          {
            id: 'evt-1',
            type: 'character-location',
            characterId: 'c-1',
            locationId: 'l-1',
            chapterIndex: 0,
            source: 'chapter',
          },
        ],
        claimedBeatIds: ['beat-1'],
        fulfilledForeshadowIds: ['f-1'],
        introducedForeshadowIds: [],
        resolvedTaskIds: ['t-1'],
        createdTaskIds: [],
      })
    )

    const agent = new TestableChapterPlannerAgent(createMockProvider())
    const output = await agent.run({
      idea: '测试',
      genre: 'default',
      totalChapters: 1,
      outline: '第1章：主角醒来',
      previousChapters: '',
      chapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    expect(output.success).toBe(true)
    const data = output.data as ChapterPlan
    expect(data.expectedEvents).toHaveLength(1)
    expect(data.expectedEvents[0]?.id).toBe('evt-1')
    expect(data.claimedBeatIds).toEqual(['beat-1'])
    expect(data.fulfilledForeshadowIds).toEqual(['f-1'])
    expect(data.introducedForeshadowIds).toEqual([])
    expect(data.resolvedTaskIds).toEqual(['t-1'])
    expect(data.createdTaskIds).toEqual([])
  })

  it('rejects expected events whose subtype fields are incomplete', async () => {
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        sections: [],
        timeline: [],
        outlineCheck: [],
        expectedEvents: [
          {
            id: 'evt-1',
            type: 'item-state',
            itemId: 'item-1',
            state: 'closed',
            chapterIndex: 0,
            source: 'chapter',
          },
        ],
      })
    )

    const agent = new TestableChapterPlannerAgent(createMockProvider())
    const output = await agent.run({
      idea: '测试',
      genre: 'default',
      totalChapters: 1,
      outline: '第1章：主角检查物品',
      previousChapters: '',
      chapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    expect(output.success).toBe(false)
    expect(output.error).toContain('expectedEvents[0]')
    expect(output.error).toContain('item-state.attribute')
  })

  it('renders the authoritative zero-based event chapter index', () => {
    const agent = new TestableChapterPlannerAgent(createMockProvider())
    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 50,
      world: '',
      characters: '',
      outline: '第26章：底稿',
      previousChapters: '',
      chapterIndex: 25,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    const prompt = messages[1]?.content ?? ''
    expect(prompt).toContain('内部零基章节索引固定为 25')
    expect(prompt).toContain('"chapterIndex": 25')
  })
})

describe('ChapterPlannerAgent JSON repair', () => {
  it('repairs literal newlines inside JSON string values', () => {
    const agent = new TestableChapterPlannerAgent(createMockProvider())
    const output = agent.parseOutput(`\`\`\`json
{
  "sections": [
    {
      "title": "段落",
      "summary": "第一行\n第二行",
      "wordCount": 100,
      "events": ["事件"],
      "characters": ["角色"],
      "timeMark": "初六"
    }
  ],
  "timeline": [{ "event": "事件", "time": "初六", "notes": "备注" }],
  "outlineCheck": [{"requirement": "测试", "fulfilled": true, "section": "段落"}],
  "chapterTimeAnchor": "初六"
}
\`\`\``)

    expect(output.success).toBe(true)
    const data = output.data as { sections: Array<{ summary: string }> }
    expect(data.sections[0]!.summary).toBe('第一行\n第二行')
  })

  it('repairs literal tabs inside JSON string values', () => {
    const agent = new TestableChapterPlannerAgent(createMockProvider())
    const output = agent.parseOutput(
      `{\n  "sections": [{\n    "title": "段落",\n    "summary": "摘要\t带制表符",\n    "wordCount": 100,\n    "events": ["事件"],\n    "characters": ["角色"],\n    "timeMark": "初六"\n  }],\n  "timeline": [{ "event": "事件", "time": "初六", "notes": "备注" }],\n  "outlineCheck": [{"requirement": "测试", "fulfilled": true, "section": "段落"}],\n  "chapterTimeAnchor": "初六"\n}`
    )

    expect(output.success).toBe(true)
    const data = output.data as { sections: Array<{ summary: string }> }
    expect(data.sections[0]!.summary).toBe('摘要\t带制表符')
  })

  it('repairs malformed closing single quote converted from smart quote', () => {
    const agent = new TestableChapterPlannerAgent(createMockProvider())
    const output = agent.parseOutput(
      `{\n  "sections": [{\n    "title": "段落",\n    "summary": "摘要",\n    "wordCount": 100,\n    "events": ["事件"],\n    "characters": ["角色"],\n    "timeMark": "初六"\n  }],\n  "timeline": [{ "event": "事件", "time": "初六", "notes": "陈裕堂线缓兵三日，但苏半城未承诺' }],\n  "outlineCheck": [{"requirement": "测试", "fulfilled": true, "section": "段落"}],\n  "chapterTimeAnchor": "初六"\n}`
    )

    expect(output.success).toBe(true)
    const data = output.data as { timeline: Array<{ notes: string }> }
    expect(data.timeline[0]!.notes).toBe('陈裕堂线缓兵三日，但苏半城未承诺')
  })

  it('keeps legitimate single quotes inside JSON string values untouched', () => {
    const agent = new TestableChapterPlannerAgent(createMockProvider())
    const output = agent.parseOutput(
      `{\n  "sections": [{\n    "title": "段落",\n    "summary": "It's a test",\n    "wordCount": 100,\n    "events": ["事件"],\n    "characters": ["角色"],\n    "timeMark": "初六"\n  }],\n  "timeline": [{ "event": "事件", "time": "初六", "notes": "备注" }],\n  "outlineCheck": [{"requirement": "测试", "fulfilled": true, "section": "段落"}],\n  "chapterTimeAnchor": "初六"\n}`
    )

    expect(output.success).toBe(true)
    const data = output.data as { sections: Array<{ summary: string }> }
    expect(data.sections[0]!.summary).toBe("It's a test")
  })
})
