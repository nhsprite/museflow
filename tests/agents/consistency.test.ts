import { describe, expect, it, vi } from 'vitest'
import type { Message, ModelProvider } from '../../src/model/provider.ts'
import type { ConsistencyAgentInput } from '../../src/agents/types.ts'
import type { CanonicalFact } from '../../src/types/story-state.ts'

function createMockProvider(chatResponse?: string): ModelProvider {
  return {
    chat: vi.fn().mockResolvedValue(chatResponse ?? ''),
    chatStructured: vi.fn().mockResolvedValue({}),
  }
}

class TestableConsistencyAgent
  extends (await import('../../src/agents/consistency.ts')).ConsistencyAgent
{
  public exposePrompt(state: Required<ConsistencyAgentInput>): Message[] {
    return this.buildPrompt(state)
  }
}

describe('ConsistencyAgent time anchor', () => {
  it('uses chapterTimeAnchor as the time origin when provided', () => {
    const agent = new TestableConsistencyAgent(createMockProvider())

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

describe('ConsistencyAgent foreshadow deadlines', () => {
  it('keeps may_remain_open foreshadows out of mandatory deadline sections', () => {
    const agent = new TestableConsistencyAgent(createMockProvider())
    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 20,
      world: '',
      characters: '【主角】',
      outline: '第10章：推进',
      chapterContent: '正文。',
      chapterIndex: 9,
      chapterSummaries: [],
      storyState: '',
      foreshadowStack: [
        {
          id: 'fs-required',
          text: '必需旧伏笔',
          expectedFulfillChapter: 5,
          createdAt: 0,
          createdAtChapter: 1,
          status: 'planted',
          isExplicit: true,
          resolutionPolicy: 'must_resolve',
          required: true,
        },
        {
          id: 'fs-optional',
          text: '可选环境细节',
          expectedFulfillChapter: Number.MAX_SAFE_INTEGER,
          createdAt: 0,
          createdAtChapter: 1,
          status: 'planted',
          isExplicit: false,
          resolutionPolicy: 'may_remain_open',
          required: false,
        },
      ],
    })

    const userMessage = messages[1]?.content ?? ''
    const overdueSection = userMessage.match(/<overdue>([\s\S]*?)<\/overdue>/)?.[1] ?? ''
    expect(overdueSection).toContain('必需旧伏笔')
    expect(overdueSection).not.toContain('可选环境细节')
  })

  it('marks overdue foreshadows as reference-only, not an error by itself', () => {
    const agent = new TestableConsistencyAgent(createMockProvider())
    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 20,
      world: '',
      characters: '【主角】',
      outline: '第10章：推进',
      chapterContent: '正文。',
      chapterIndex: 9,
      chapterSummaries: [],
      storyState: '',
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
      ],
    })

    const userMessage = messages[1]?.content ?? ''
    const overdueSection = userMessage.match(/<overdue>([\s\S]*?)<\/overdue>/)?.[1] ?? ''
    expect(overdueSection).toContain('逾期本身不是错误')
    expect(userMessage).toContain('不得仅因伏笔逾期未回收而报 error')
    expect(userMessage).toContain('声称回收某伏笔')
  })
})

describe('ConsistencyAgent outline-authorized facts', () => {
  it('includes outline-inferred facts in prompt as hint-level, text-first facts', () => {
    const agent = new TestableConsistencyAgent(createMockProvider())
    const canonicalFacts: CanonicalFact[] = [
      {
        id: 'f1',
        subject: '主角',
        attribute: 'status',
        value: '负伤',
        establishedIn: 1,
        confidence: 'medium',
        source: 'outline_inference',
      },
      {
        id: 'f2',
        subject: '密信',
        attribute: 'origin',
        value: '旧友暗中递送',
        establishedIn: 1,
        confidence: 'medium',
        source: 'outline_inference',
      },
    ]

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【主角】',
      outline: '第2章：接头',
      chapterContent: '主角收到密信。',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: ['第1章：主角离家。'],
      storyState: '【上一章结束时间】\n故事时间第一日',
      canonicalFacts,
      chapterTimeAnchor: '故事时间第二日',
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('大纲推断事实（仅供参考，正文优先）')
    expect(userMessage).toContain('[主角] status: 负伤')
    expect(userMessage).toContain('[密信] origin: 旧友暗中递送')
    expect(userMessage).not.toContain('本章大纲已授权的新事实')
  })

  it('states that chapter text wins over outline-inferred facts with at most a warning', () => {
    const agent = new TestableConsistencyAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【主角】',
      outline: '第2章：接头',
      chapterContent: '主角收到密信。',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: [],
      storyState: '',
      chapterTimeAnchor: '故事时间第二日',
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('以正文为准')
    expect(userMessage).toContain('最多报 warning，不得报 error')
    expect(userMessage).toContain('只有与已确立权威事实（非推断）冲突才可报 error')
  })
})

describe('ConsistencyAgent previous summary', () => {
  it('renders previous chapter summaries as narrative reference after the outline', () => {
    const agent = new TestableConsistencyAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【主角】',
      outline: '第2章：接头',
      previousChapters: '第1章：主角离家，与旧友失散。',
      chapterContent: '主角在废弃仓库收到密信。',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: ['第1章：主角离家。'],
      storyState: '【权威事实】\n- [主角] 所在位置: 城东茶楼',
      chapterTimeAnchor: '故事时间第二日',
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('<previous_summary>')
    expect(userMessage).toContain('第1章：主角离家，与旧友失散。')
    expect(userMessage).toContain('叙事参考')
    expect(userMessage).toContain('不作为事实依据')
    expect(userMessage).not.toContain('{previousSummary}')
    expect(userMessage.indexOf('<previous_summary>')).toBeGreaterThan(
      userMessage.indexOf('</outline>')
    )
    expect(userMessage.indexOf('<previous_summary>')).toBeLessThan(
      userMessage.indexOf('<story_state>')
    )
  })

  it('uses a first-chapter placeholder and no longer renders a separate superseded facts section', () => {
    const agent = new TestableConsistencyAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【主角】',
      outline: '第1章：开端',
      chapterContent: '主角登场。',
      chapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
      storyState: '',
      supersededFacts: '- [旧物] 已废弃（原因：大纲更新）',
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('（这是第一章）')
    expect(userMessage).not.toContain('<superseded_facts>')
    expect(userMessage).not.toContain('{supersededFacts}')
  })
})

describe('ConsistencyAgent canonical facts authority', () => {
  it('uses story_state as the single factual authority', () => {
    const agent = new TestableConsistencyAgent(createMockProvider())

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
    const agent = new TestableConsistencyAgent(createMockProvider())

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
    expect(userMessage).toContain(
      '一致性检查必须以本区域中的【权威事实】和【已被覆盖的旧事实】为准'
    )
    expect(userMessage).toContain(
      '如果本章内容与【权威事实】中的当前有效值一致，即使与旧摘要或旧时间线中的旧值不同，也不构成矛盾'
    )
  })
})

describe('ConsistencyAgent outline detail tolerance', () => {
  it('distinguishes core event deviation from execution detail differences in prompt', () => {
    const agent = new TestableConsistencyAgent(createMockProvider())
    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 2,
      world: '',
      characters: '【主角】',
      outline: '第2章：接头',
      chapterContent: '正文。',
      chapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: [],
      storyState: '',
      chapterTimeAnchor: '故事时间第二日',
    })

    const userMessage = messages[1]?.content ?? ''
    expect(userMessage).toContain('核心事件偏离')
    expect(userMessage).toContain('执行细节差异')
    expect(userMessage).toContain('大纲执行细节差异')
  })

  it('downgrades outline execution-detail errors to quality warnings', async () => {
    const agent = new TestableConsistencyAgent(createMockProvider())
    const output = {
      success: true,
      content: '',
      data: {
        is_consistent: false,
        issues: [
          {
            type: 'consistency',
            severity: 'error',
            description: '正文用“提出”印泥盒，大纲用“旋出”，操作细节不同。',
            aspect: 'outline',
            subject: 'item-inkpad',
            location: '第3段',
          },
        ],
      },
    }

    const issues = await agent.processOutput(output)

    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].dimension).toBe('quality')
  })

  it('keeps outline core deviation as error when source_reference is provided', async () => {
    const agent = new TestableConsistencyAgent(createMockProvider())
    const output = {
      success: true,
      content: '',
      data: {
        is_consistent: false,
        issues: [
          {
            type: 'consistency',
            severity: 'error',
            description: '本章遗漏大纲要求的主角揭盒盖核心情节。',
            aspect: 'outline',
            subject: 'c-hero',
            source_reference: 'outline:第2章：接头',
            reader_confusion: '读者会疑惑印泥盒线索如何被发现。',
          },
        ],
      },
    }

    const issues = await agent.processOutput(output)

    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('error')
    expect(issues[0].dimension).not.toBe('quality')
  })
})
