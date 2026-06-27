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
    expect(userMessage).toContain('<chapter_content>')
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
    expect(userMessage).toContain('<title>Test Title</title>')
    expect(userMessage).toContain('<number>第6章</number>')
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
    expect(userMessage).toContain('<title>未知</title>')
    expect(userMessage).toContain('<number>未知</number>')
  })

  it('includes official character whitelist in prompt', () => {
    const agent = new TestableSummaryAgent()
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
    const agent = new TestableSummaryAgent()
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
