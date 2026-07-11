import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, ModelProvider } from '../../src/model/provider.ts'
import type { ChapterAgentInput } from '../../src/agents/types.ts'
import type { Issue } from '../../src/types/agent.ts'
import type { StoryEvent } from '../../src/types/story-memory.js'
import type { StoryArc } from '../../src/types/outline.js'

function createMockProvider(chatResponse?: string): ModelProvider {
  return {
    chat: vi.fn().mockResolvedValue(chatResponse ?? ''),
    chatStructured: vi.fn().mockResolvedValue({}),
  }
}

class TestableChapterAgent extends (await import('../../src/agents/chapter.ts')).ChapterAgent {
  public exposePrompt(state: Required<ChapterAgentInput>): Message[] {
    return this.buildPrompt(state)
  }

  public exposeParse(content: string): {
    success: boolean
    content: string
    data?: Record<string, unknown>
  } {
    return this.parse(content) as {
      success: boolean
      content: string
      data?: Record<string, unknown>
    }
  }
}

describe('ChapterAgent chapter numbering', () => {
  it('builds the first chapter prompt with display numbering', () => {
    const agent = new TestableChapterAgent(createMockProvider())

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

  it('keeps optional overdue foreshadows out of the mandatory overdue section', () => {
    const agent = new TestableChapterAgent(createMockProvider())
    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 20,
      world: '',
      characters: '【主角】',
      outline: '第10章：推进',
      previousChapters: '',
      chapterContent: '',
      chapterIndex: 9,
      chapterSummaries: [],
      foreshadowStack: [
        {
          id: 'fs-required',
          text: '必需旧伏笔',
          expectedFulfillChapter: 5,
          createdAt: 0,
          createdAtChapter: 1,
          status: 'planted',
          isExplicit: true,
          required: true,
        },
        {
          id: 'fs-optional',
          text: '可选环境细节',
          expectedFulfillChapter: 5,
          createdAt: 0,
          createdAtChapter: 1,
          status: 'planted',
          isExplicit: false,
          required: false,
        },
      ],
    })

    const userMessage = messages[1]?.content ?? ''
    const overdueSection = userMessage.match(/<overdue>([\s\S]*?)<\/overdue>/)?.[1] ?? ''
    expect(overdueSection).toContain('必需旧伏笔')
    expect(overdueSection).not.toContain('可选环境细节')
    expect(userMessage).toContain('expected 必须是严格晚于本章的 1-based 整数章节号')
  })

  it('includes issue suggestions in rewrite prompts', () => {
    const agent = new TestableChapterAgent(createMockProvider())

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

  it('includes structured writing constraints as mandatory chapter requirements', () => {
    const agent = new TestableChapterAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: '书信体悬疑',
      genre: 'mystery',
      totalChapters: 3,
      world: '近代城镇',
      characters: '【侦探】主角',
      outline: '第1章：旧案来信\n侦探收到第一封信并接触案情',
      previousChapters: '',
      chapterContent: '',
      chapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
      writingConstraints: {
        chapterOpening: {
          type: 'letter',
          required: true,
          instruction: '每章在章节标题后必须先写一封信，信后正文才进入案情叙述。',
        },
      },
    } as Required<ChapterAgentInput> & {
      writingConstraints: {
        chapterOpening: { type: 'letter'; required: true; instruction: string }
      }
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('<writing_constraints>')
    expect(userMessage).toContain('【全书写作形式硬约束】')
    expect(userMessage).toContain('章节标题之后的第一段必须满足：每章在章节标题后必须先写一封信')
    expect(userMessage).toContain('PRE_WRITE_CHECK')
    expect(userMessage).toContain('章节开头形式')
  })

  it('includes canonical fact verification section when storyState is provided', () => {
    const agent = new TestableChapterAgent(createMockProvider())

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
      storyState:
        '【角色位置】\n林玄：破庙\n\n【角色状态】\n林玄：受伤\n\n【关键物品】\n通灵宝玉：女娲补天遗石\n\n【已揭示的秘密】\n通灵宝玉与石猴同出青埂峰\n\n【已被覆盖的旧事实】\n林玄原名林二',
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
    const agent = new TestableChapterAgent(createMockProvider())

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

  it('includes chapterTimeAnchor when provided in chapterPlan', () => {
    const agent = new TestableChapterAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【苏半城】主角',
      outline: '第2章：茶楼暗访\n三日期限内展开调查',
      previousChapters: '第1章：主角会见亲王，获三日期限。',
      chapterContent: '',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: [],
      storyState: '【上一章结束时间】\n出殡后第三日午时',
      chapterPlan: {
        sections: [
          {
            title: '第一日',
            summary: '主角开始调查',
            wordCount: 1000,
            events: ['开始调查'],
            characters: ['苏半城'],
            timeMark: '三日期限第一日',
          },
        ],
        timeline: [{ event: '开始调查', time: '第一日', notes: '' }],
        outlineCheck: [],
        chapterTimeAnchor: '三日期限第一日卯时（回溯覆盖第5章后三日）',
      },
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('本章时间锚点')
    expect(userMessage).toContain('三日期限第一日卯时')
    expect(userMessage).toContain('本章允许采用回忆、倒叙或跨日叙事')
    expect(userMessage).toContain('上一章结束时间')
  })

  it('sorts canonical facts by outline relevance', () => {
    const agent = new TestableChapterAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【苏半城】主角',
      outline: '第2章：长命锁之谜\n主角调查长命锁的来源',
      previousChapters: '第1章：主角获得长命锁。',
      chapterContent: '',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: [],
      storyState: `【权威事实】
- [长命锁] 来源: 苏家满月礼
- [玉佩] 来源: 皇家赏赐
- [令牌] 来源: 师父所赠`,
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('长命锁')
    expect(userMessage.indexOf('长命锁')).toBeLessThan(userMessage.indexOf('玉佩'))
    expect(userMessage.indexOf('玉佩')).toBeLessThan(userMessage.indexOf('令牌'))
  })

  it('marks previous summaries as narrative context only, not factual authority', () => {
    const agent = new TestableChapterAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【苏半城】主角',
      outline: '第2章：长命锁之谜\n主角调查长命锁的来源',
      previousChapters: '第1章：主角获得长命锁。',
      chapterContent: '',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('【叙事氛围参考】')
    expect(userMessage).toContain('不作为事实依据')
    expect(userMessage).toContain('以【权威事实】为准')
  })

  it('uses story_state as the single factual authority', () => {
    const agent = new TestableChapterAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【苏半城】主角',
      outline: '第2章：长命锁之谜\n主角调查长命锁的来源',
      previousChapters: '第1章：主角获得长命锁。',
      chapterContent: '',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: [],
      storyState: '【权威事实】\n- [长命锁] 来源: 苏家满月礼',
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('【权威事实 - 本章写作的唯一事实依据】')
    expect(userMessage).not.toContain('<key_events>')
    expect(userMessage).not.toContain('timeline_state')
  })

  it('includes anti-hallucination constraints about item origins', () => {
    const agent = new TestableChapterAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【苏半城】主角',
      outline: '第1章：破庙惊梦\n少年在破庙中醒来',
      previousChapters: '',
      chapterContent: '',
      chapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain(
      '涉及关键物品/设定的来源、制造者、来历、赠予者时，必须与【权威事实】中的记录一致'
    )
    expect(userMessage).toContain('严禁 invent 具体来源')
  })
})

describe('ChapterAgent beat mapping', () => {
  it('includes beat mapping section with claimed and available beats', () => {
    const agent = new TestableChapterAgent(createMockProvider())

    const storyArc: StoryArc = {
      totalChapters: 5,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 3,
          title: '启程',
          theme: '出发',
          function: '建立动机',
          mandatoryBeats: ['身份暴露', '阵营洗牌'],
        },
      ],
      keyBeats: [
        { id: 'act1-b1', beat: '身份暴露', deadlineAct: 1, required: true },
        { id: 'act1-b2', beat: '阵营洗牌', deadlineAct: 1, required: true },
      ],
    }

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 5,
      world: '',
      characters: '【主角】少年',
      outline: '第1章：破庙惊梦\n少年在破庙中醒来',
      previousChapters: '',
      chapterContent: '',
      chapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
      storyArc,
      chapterPlan: {
        chapterIndex: 0,
        sections: [],
        timeline: [],
        outlineCheck: [],
        expectedEvents: [],
        claimedBeatIds: [],
        claimedMandatoryBeatIds: ['A1-M1'],
        fulfilledForeshadowIds: [],
        introducedForeshadowIds: [],
        resolvedTaskIds: [],
        createdTaskIds: [],
      },
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('<beat_mapping>')
    expect(userMessage).toContain('当前幕 mandatory beat ID 映射')
    expect(userMessage).toContain('A1-M1: 身份暴露')
    expect(userMessage).toContain('A1-M2: 阵营洗牌')
    expect(userMessage).not.toContain('act1-b1: 身份暴露')
    expect(userMessage).toContain('<claimed_beats>')
    expect(userMessage).toContain('<available_beats>')
    expect(userMessage).toContain('plot-advance: act-1 / <beatId>')
  })

  it('omits beat mapping section when storyArc is missing', () => {
    const agent = new TestableChapterAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 3,
      world: '',
      characters: '【主角】少年',
      outline: '第1章：破庙惊梦\n少年在破庙中醒来',
      previousChapters: '',
      chapterContent: '',
      chapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).not.toContain('<beat_mapping>')
  })
})

describe('ChapterAgent.parse', () => {
  it('extracts content after CHAPTER_CONTENT marker', () => {
    const agent = new TestableChapterAgent(createMockProvider())
    const raw = `=== PRE_WRITE_CHECK ===
- 检查项1
=== CHAPTER_CONTENT ===
## 第四章 王府递帖

正文内容。`
    const result = agent.exposeParse(raw)
    expect(result.success).toBe(true)
    expect(result.content).toContain('## 第四章 王府递帖')
    expect(result.content).not.toContain('PRE_WRITE_CHECK')
    expect(result.data?.storyEvents).toBeDefined()
    expect(result.data?.storyEvents).toEqual([])
  })

  it('recognizes Chinese numeral chapter headings', () => {
    const agent = new TestableChapterAgent(createMockProvider())
    const raw = `=== PRE_WRITE_CHECK ===
- 检查项
=== CHAPTER_CONTENT ===
## 第四章：王府递帖

正文内容。`
    const result = agent.exposeParse(raw)
    expect(result.success).toBe(true)
    expect(result.content).toContain('## 第四章：王府递帖')
    expect(result.content).not.toContain('检查项')
  })

  it('truncates pre-write artifacts before chapter heading', () => {
    const agent = new TestableChapterAgent(createMockProvider())
    const raw = `预写对齐检查表
| 检查项 | 来源 |
| 大纲情节点1 | 大纲 |
## 第4章 王府递帖

正文内容。`
    const result = agent.exposeParse(raw)
    expect(result.success).toBe(true)
    expect(result.content).toContain('## 第4章 王府递帖')
    expect(result.content).not.toContain('预写对齐检查表')
    expect(result.data?.storyEvents).toBeDefined()
  })

  it('extracts story events from STORY_EVENTS block', async () => {
    const raw = `=== PRE_WRITE_CHECK ===
- 检查项1
=== STORY_EVENTS ===
- character-location: char-1 -> loc-1
- foreshadow-fulfill: fs-1
- plot-advance: plot-1 / beat-1
=== CHAPTER_CONTENT ===
## 第四章 王府递帖

正文内容。`
    const agent = new TestableChapterAgent(createMockProvider(raw))
    const result = await agent.run({
      idea: '测试',
      genre: 'default',
      totalChapters: 5,
      chapterIndex: 2,
    })
    expect(result.success).toBe(true)
    expect(result.content).toContain('## 第四章 王府递帖')
    const events = (result.data as { storyEvents?: StoryEvent[] } | undefined)?.storyEvents ?? []
    expect(events).toHaveLength(3)
    expect(events[0]?.type).toBe('character-location')
    expect(events[1]?.type).toBe('foreshadow-fulfill')
    expect(events[2]?.type).toBe('plot-advance')
    expect(events[0]?.chapterIndex).toBe(2)
    expect(events[1]?.chapterIndex).toBe(2)
    expect(events[2]?.chapterIndex).toBe(2)
  })
})
