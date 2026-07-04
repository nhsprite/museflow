import { describe, expect, it, vi } from 'vitest'
import type { Message, ModelProvider } from '../../src/model/provider.ts'
import type { SummaryAgentInput } from '../../src/agents/types.ts'

function createMockProvider(chatResponse?: string): ModelProvider {
  return {
    chat: vi.fn().mockResolvedValue(chatResponse ?? ''),
    chatStructured: vi.fn().mockResolvedValue({}),
  }
}

class TestableSummaryAgent extends (await import('../../src/agents/summary.ts')).SummaryAgent {
  public exposePrompt(state: Required<SummaryAgentInput>): Message[] {
    return this.buildPrompt(state)
  }
}

describe('SummaryAgent prompt', () => {

  it('includes chapter content in the prompt', () => {
    const agent = new TestableSummaryAgent(createMockProvider())
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
    expect(userMessage).toContain('<chapter_content>')
  })

  it('includes chapter title and index in the prompt', () => {
    const agent = new TestableSummaryAgent(createMockProvider())

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
    expect(userMessage).toContain('<title>Test Title</title>')
    expect(userMessage).toContain('<number>第6章</number>')
  })

  it('shows empty content placeholder when chapterContent is undefined', () => {
    const agent = new TestableSummaryAgent(createMockProvider())

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
    expect(userMessage).toContain('<title>未知</title>')
    expect(userMessage).toContain('<number>未知</number>')
  })

  it('includes official character whitelist in prompt', () => {
    const agent = new TestableSummaryAgent(createMockProvider())
    const messages = agent.exposePrompt({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterContent: '苏半城在房中。',
      chapterTitle: 'Test',
      chapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
      charactersList: [{ id: '1', storyId: 's', name: '苏半城', description: '主角', createdAt: 1 }],
    })
    const userMessage = messages.find(m => m.role === 'user')?.content ?? ''
    expect(userMessage).toContain('<official_characters>')
    expect(userMessage).toContain('苏半城')
  })

  it('includes canonicalFacts schema in prompt', () => {
    const agent = new TestableSummaryAgent(createMockProvider())
    const messages = agent.exposePrompt({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterContent: 'test content',
      chapterTitle: 'Test',
      chapterIndex: 5,
      foreshadowStack: [],
      chapterSummaries: [],
    })
    const userMessage = messages.find(m => m.role === 'user')?.content ?? ''
    expect(userMessage).toContain('canonicalFacts')
    expect(userMessage).toContain('subject')
    expect(userMessage).toContain('attribute')
    expect(userMessage).toContain('supersedes')
    expect(userMessage).toContain('<canonical_facts_requirements>')
  })

  it('extracts canonical facts from SummaryAgent output', async () => {
    const { processSummaryOutput } = await import('../../src/agents/summary.ts')
    const output = {
      success: true as const,
      data: {
        characters: [],
        characterFacts: [],
        keyEvents: [],
        locations: [],
        keyItems: [],
        activePlots: [],
        mood: '',
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: {},
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          canonicalFacts: [
            {
              subject: '木之灵物',
              attribute: '所在位置',
              value: '昆仑山',
              establishedIn: 2,
              supersedes: [{ chapter: 0, oldValue: '东方灵河旧址' }],
            },
            {
              subject: '',
              attribute: '身份',
              value: '主角',
            },
          ],
          currentScene: '昆仑山',
          storyTime: '第三日',
        },
      },
    }

    const result = processSummaryOutput(output, 2)
    expect(result).not.toBeNull()
    expect(result?.storyState?.canonicalFacts).toHaveLength(1)
    expect(result?.storyState?.canonicalFacts?.[0]).toMatchObject({
      id: 'cf_2_0',
      subject: '木之灵物',
      attribute: '所在位置',
      value: '昆仑山',
      establishedIn: 2,
      supersedes: [{ chapter: 0, oldValue: '东方灵河旧址' }],
    })
  })

  it('extracts verifiedBeats from SummaryAgent output', async () => {
    const { processSummaryOutput } = await import('../../src/agents/summary.ts')
    const output = {
      success: true as const,
      data: {
        characters: [],
        characterFacts: [],
        keyEvents: [],
        locations: [],
        keyItems: [],
        activePlots: [],
        mood: '',
        verifiedBeats: ['主角失去庇护', '反派首次施压'],
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: {},
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          canonicalFacts: [],
          currentScene: '',
          storyTime: '',
        },
      },
    }

    const result = processSummaryOutput(output, 2)
    expect(result?.verifiedBeats).toEqual(['主角失去庇护', '反派首次施压'])
  })

  it('extracts chapter handoff and verified beat evidence from SummaryAgent output', async () => {
    const { processSummaryOutput } = await import('../../src/agents/summary.ts')
    const chapterContent = '主角把铜钥匙交给同伴，叮嘱他天亮前守住后门。随后二人留在仓库外等候。'
    const output = {
      success: true as const,
      data: {
        characters: [],
        characterFacts: [],
        keyEvents: [],
        locations: [],
        keyItems: [],
        activePlots: [],
        mood: '',
        verifiedBeats: ['主角交出关键物品'],
        verifiedBeatEvidence: [
          {
            beat: '主角交出关键物品',
            confidence: 'high',
            evidence: {
              chapterIndex: 1,
              quote: '主角把铜钥匙交给同伴',
            },
          },
        ],
        storyState: {
          characterLocations: { 主角: '仓库外' },
          characterStatus: {},
          keyItemsLocation: { 铜钥匙: '同伴手中' },
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          canonicalFacts: [],
          currentScene: '仓库外',
          storyTime: '夜里',
          chapterHandoff: {
            chapterNumber: 2,
            endScene: '仓库外',
            endTime: '夜里',
            charactersPresent: ['主角', '同伴'],
            lastAction: '二人留在仓库外等候',
            openQuestions: ['后门是否能守住'],
            requiredNextOpening: '下一章应承接二人在仓库外等候的状态',
          },
        },
      },
    }

    const result = processSummaryOutput(output, 1, undefined, undefined, chapterContent, ['主角交出关键物品'])

    expect(result?.storyState?.chapterHandoff).toMatchObject({
      chapterNumber: 2,
      endScene: '仓库外',
      lastAction: '二人留在仓库外等候',
      requiredNextOpening: '下一章应承接二人在仓库外等候的状态',
    })
    expect(result?.verifiedBeatEvidence).toEqual([
      {
        beat: '主角交出关键物品',
        chapterIndex: 1,
        quote: '主角把铜钥匙交给同伴',
        confidence: 'high',
      },
    ])
  })

  it('normalizes verifiedBeats to matching claimedBeats and drops unrelated descriptions', async () => {
    const { processSummaryOutput } = await import('../../src/agents/summary.ts')
    const output = {
      success: true as const,
      data: {
        characters: [],
        characterFacts: [],
        keyEvents: [],
        locations: [],
        keyItems: [],
        activePlots: [],
        mood: '',
        verifiedBeats: [
          '主角以新身份重返京城并初步立足',
          '本章描写了主角回忆灭门惨案的细节，完成了家族灭门旧事的简要回溯与主角身世确认',
          '这是一个无关的摘要描述',
        ],
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: {},
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          canonicalFacts: [],
          currentScene: '',
          storyTime: '',
        },
      },
    }

    const claimedBeats = [
      '家族灭门旧事的简要回溯与主角身世确认',
      '主角以新身份重返京城并初步立足',
      '联姻棋局传闻浮现（被指婚对象与仇家关联）',
    ]
    const result = processSummaryOutput(output, 2, undefined, undefined, undefined, claimedBeats)
    expect(result?.verifiedBeats).toEqual([
      '主角以新身份重返京城并初步立足',
      '家族灭门旧事的简要回溯与主角身世确认',
    ])
  })

  it('preserves canonical fact id when provided', async () => {
    const { processSummaryOutput } = await import('../../src/agents/summary.ts')
    const output = {
      success: true as const,
      data: {
        characters: [],
        characterFacts: [],
        keyEvents: [],
        locations: [],
        keyItems: [],
        activePlots: [],
        mood: '',
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: {},
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          canonicalFacts: [
            { id: 'custom-id', subject: '样本', attribute: '位置', value: '实验室B', establishedIn: 3 },
          ],
          currentScene: '',
          storyTime: '',
        },
      },
    }

    const result = processSummaryOutput(output, 3)
    expect(result?.storyState?.canonicalFacts?.[0].id).toBe('custom-id')
  })

  it('normalizes extracted canonical facts to the current zero-based chapter index', async () => {
    const { processSummaryOutput } = await import('../../src/agents/summary.ts')
    const output = {
      success: true as const,
      data: {
        characters: [],
        characterFacts: [],
        keyEvents: [],
        locations: [],
        keyItems: [],
        activePlots: [],
        mood: '',
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: {},
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          canonicalFacts: [
            {
              subject: '目标章关键事件',
              attribute: '关键事件',
              value: '主角已完成关键事件',
              establishedIn: 26,
              evidence: { chapterIndex: 26, quote: '主角已完成关键事件' },
            },
          ],
          currentScene: '',
          storyTime: '',
        },
      },
    }

    const result = processSummaryOutput(output, 25, undefined, undefined, '主角已完成关键事件。')
    const fact = result?.storyState?.canonicalFacts?.[0]
    expect(fact?.establishedIn).toBe(25)
    expect(fact?.evidence?.chapterIndex).toBe(25)
  })

  it('disambiguates ambiguous pronouns in canonical fact values', async () => {
    const { processSummaryOutput } = await import('../../src/agents/summary.ts')
    const output = {
      success: true as const,
      data: {
        characters: [],
        characterFacts: [],
        keyEvents: [],
        locations: [],
        keyItems: [],
        activePlots: [],
        mood: '',
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: {},
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          canonicalFacts: [
            {
              subject: '某关键道具',
              attribute: '用途',
              value: '此物不用于新走账通道',
              establishedIn: 4,
            },
          ],
          currentScene: '',
          storyTime: '',
        },
      },
    }

    const result = processSummaryOutput(output, 4)
    expect(result?.storyState?.canonicalFacts?.[0].value).toBe('某关键道具不用于新走账通道')
  })

  it('disambiguates ambiguous pronouns in superseded old values', async () => {
    const { processSummaryOutput } = await import('../../src/agents/summary.ts')
    const output = {
      success: true as const,
      data: {
        characters: [],
        characterFacts: [],
        keyEvents: [],
        locations: [],
        keyItems: [],
        activePlots: [],
        mood: '',
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: {},
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          canonicalFacts: [
            {
              subject: '样本A',
              attribute: '所在位置',
              value: '样本A在实验室B',
              establishedIn: 3,
              supersedes: [{ chapter: 1, oldValue: '此物在实验室A' }],
            },
          ],
          currentScene: '',
          storyTime: '',
        },
      },
    }

    const result = processSummaryOutput(output, 3)
    expect(result?.storyState?.canonicalFacts?.[0].supersedes?.[0].oldValue).toBe('样本A在实验室A')
  })

  it('keeps unambiguous canonical fact values unchanged', async () => {
    const { processSummaryOutput } = await import('../../src/agents/summary.ts')
    const output = {
      success: true as const,
      data: {
        characters: [],
        characterFacts: [],
        keyEvents: [],
        locations: [],
        keyItems: [],
        activePlots: [],
        mood: '',
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: {},
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          canonicalFacts: [
            {
              subject: '样本A',
              attribute: '所在位置',
              value: '样本A在实验室B',
              establishedIn: 3,
            },
          ],
          currentScene: '',
          storyTime: '',
        },
      },
    }

    const result = processSummaryOutput(output, 3)
    expect(result?.storyState?.canonicalFacts?.[0].value).toBe('样本A在实验室B')
  })

})

import { processSummaryOutput } from '../../src/agents/summary.js'

describe('processSummaryOutput sourceFacts', () => {
  it('promotes explicit sourceFacts to canonicalFacts', () => {
    const output = {
      success: true,
      data: {
        characters: [],
        characterFacts: [],
        keyEvents: [],
        locations: [],
        keyItems: [{ text: '龙纹玉佩：主角随身玉佩', importance: 'critical' }],
        activePlots: [],
        mood: '沉重',
        sourceFacts: [
          { subject: '龙纹玉佩', attribute: '制造者', value: '前朝铸玉大师周子衡' },
        ],
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: { '龙纹玉佩': '主角怀中' },
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          currentScene: '客栈',
          storyTime: '子时',
        },
      },
    }

    const result = processSummaryOutput(output, 2)
    expect(result).not.toBeNull()
    const facts = result!.storyState?.canonicalFacts ?? []
    expect(facts.some(f => f.subject === '龙纹玉佩' && f.attribute === '制造者' && f.value === '前朝铸玉大师周子衡')).toBe(true)
  })

  it('keeps multiple canonical facts with same subject and attribute but different values', () => {
    const output = {
      success: true,
      data: {
        characters: [],
        characterFacts: [],
        keyEvents: [],
        locations: [],
        keyItems: [],
        activePlots: [],
        mood: '紧张',
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: {},
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          currentScene: '书房',
          storyTime: '深夜',
          canonicalFacts: [
            { subject: '顾承舟', attribute: '已知信息', value: '顾承舟知道凶手是管家', establishedIn: 3 },
            { subject: '顾承舟', attribute: '已知信息', value: '顾承舟知道密信藏在书房', establishedIn: 3 },
          ],
        },
      },
    }

    const result = processSummaryOutput(output, 3)
    const facts = result!.storyState!.canonicalFacts ?? []
    expect(facts.filter(f => f.subject === '顾承舟' && f.attribute === '已知信息').length).toBe(2)
  })

  it('does not auto-promote characterFacts or keyItems to canonicalFacts', () => {
    const output = {
      success: true,
      data: {
        characters: [],
        characterFacts: [
          {
            character: '顾承舟',
            facts: [
              { text: '顾承舟知道凶手是管家', importance: 'critical' },
              { text: '顾承舟承诺为苏晚棠报仇', importance: 'critical' },
            ],
          },
        ],
        keyEvents: [],
        locations: [],
        keyItems: [
          { text: '长命锁：鹤卿颈上的金银错丝长命锁，是苏家打的满月礼', importance: 'critical' },
        ],
        activePlots: [],
        mood: '紧张',
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: {},
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          currentScene: '书房',
          storyTime: '深夜',
          canonicalFacts: [],
        },
      },
    }

    const result = processSummaryOutput(output, 3)
    expect(result!.storyState!.canonicalFacts).toHaveLength(0)
  })

  it('preserves evidence and confidence from explicit sourceFacts', () => {
    const output = {
      success: true,
      data: {
        characters: [],
        characterFacts: [],
        keyEvents: [],
        locations: [],
        keyItems: [],
        activePlots: [],
        mood: '沉重',
        sourceFacts: [
          {
            subject: '龙纹玉佩',
            attribute: '制造者',
            value: '前朝铸玉大师周子衡',
            confidence: 'high',
            evidence: { chapterIndex: 2, quote: '龙纹玉佩出自前朝铸玉大师周子衡之手' },
          },
        ],
        storyState: {
          characterLocations: {},
          characterStatus: {},
          keyItemsLocation: { '龙纹玉佩': '主角怀中' },
          keyItemsState: {},
          activePlots: [],
          revealedSecrets: [],
          pendingTasks: [],
          currentScene: '客栈',
          storyTime: '子时',
          canonicalFacts: [],
        },
      },
    }

    const result = processSummaryOutput(
      output,
      2,
      undefined,
      undefined,
      '龙纹玉佩出自前朝铸玉大师周子衡之手，是主角母亲临终前留下的遗物。',
    )
    const facts = result!.storyState!.canonicalFacts ?? []
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      subject: '龙纹玉佩',
      attribute: '制造者',
      value: '前朝铸玉大师周子衡',
      confidence: 'high',
      source: 'chapter_text',
      evidence: {
        chapterIndex: 2,
        quote: '龙纹玉佩出自前朝铸玉大师周子衡之手',
      },
    })
  })
})
