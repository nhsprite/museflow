import { describe, expect, it, vi } from 'vitest'
import { ChapterOutlineAgent } from '../../src/agents/chapter-outline.js'
import type { ChapterOutlineAgentInput } from '../../src/agents/types.ts'
import type { ModelProvider } from '../../src/model/provider.ts'

const mockChat = vi.fn(async (): Promise<string> => '')

function createMockProvider(): ModelProvider {
  return {
    chat: mockChat,
    chatStructured: vi.fn().mockResolvedValue({}),
  }
}

describe('ChapterOutlineAgent', () => {
  const storyArc = {
    totalChapters: 6,
    acts: [
      {
        index: 1,
        startChapter: 1,
        endChapter: 3,
        title: '入局',
        theme: '主角被卷入冲突',
        function: '建立动机与初始张力',
        mandatoryBeats: ['主角失去庇护', '反派首次施压'],
      },
      {
        index: 2,
        startChapter: 4,
        endChapter: 6,
        title: '反击',
        theme: '主角开始反击',
        function: '展示主角成长与对抗升级',
        mandatoryBeats: ['主角找到盟友'],
      },
    ],
    keyBeats: [{ id: 'A1-B1', beat: '核心秘密被主角获悉', deadlineAct: 1, required: true }],
  }

  it('parses chapter outline with claimed beats', async () => {
    const agent = new ChapterOutlineAgent(createMockProvider())
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        title: '风雨欲来',
        description: '主角在旧宅中整理遗物，发现父亲留下的一枚玉佩，隐约觉察家族覆灭另有隐情。',
        introducedCharacters: ['老管家'],
        claimedBeats: ['主角失去庇护'],
      })
    )

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 6,
      chapterIndex: 0,
      storyArc,
      actProgress: { 1: { consumed: [], pending: ['主角失去庇护', '反派首次施压'] } },
    } as ChapterOutlineAgentInput)

    expect(output.success).toBe(true)
    const result = output.data as {
      title: string
      description: string
      claimedBeats: string[]
      claimedBeatIds: string[]
      fulfilledForeshadowIds: string[]
      touchedCharacterIds: string[]
    }
    expect(result.title).toBe('风雨欲来')
    expect(result.claimedBeats).toContain('主角失去庇护')
    expect(result.claimedBeatIds).toEqual([])
    expect(result.fulfilledForeshadowIds).toEqual([])
    expect(result.touchedCharacterIds).toEqual([])
  })

  it('returns error when output is invalid', async () => {
    const agent = new ChapterOutlineAgent(createMockProvider())
    mockChat.mockResolvedValueOnce('invalid json')

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 6,
      chapterIndex: 0,
      storyArc,
      actProgress: { 1: { consumed: [], pending: ['主角失去庇护'] } },
    } as ChapterOutlineAgentInput)

    expect(output.success).toBe(false)
  })

  it('filters empty introduced characters and beats', async () => {
    const agent = new ChapterOutlineAgent(createMockProvider())
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        title: '过渡',
        description: '主角在城中稍作休整，打探消息。',
        introducedCharacters: ['', '  '],
        claimedBeats: [''],
      })
    )

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 6,
      chapterIndex: 1,
      storyArc,
      actProgress: { 1: { consumed: ['主角失去庇护'], pending: ['反派首次施压'] } },
    } as ChapterOutlineAgentInput)

    expect(output.success).toBe(true)
    const result = output.data as { introducedCharacters?: string[]; claimedBeats?: string[] }
    expect(result.introducedCharacters).toEqual([])
    expect(result.claimedBeats).toEqual([])
  })

  it('includes closing phase prompt near the end of the story', async () => {
    const agent = new ChapterOutlineAgent(createMockProvider())
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        title: '过渡',
        description: '主角整理线索，为最终对决做准备。',
        claimedBeats: [],
      })
    )

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 20,
      chapterIndex: 17,
      storyArc,
      actProgress: { 1: { consumed: ['主角失去庇护'], pending: ['反派首次施压'] } },
    } as ChapterOutlineAgentInput)

    expect(output.success).toBe(true)
  })

  it('instructs the model to reserve conflict for hard fact contradictions', async () => {
    const agent = new ChapterOutlineAgent(createMockProvider())
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        title: '过渡',
        description: '主角整理线索，暂不推进新的强制节拍。',
        claimedBeats: [],
        conflict: false,
        conflictReason: '',
      })
    )

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 6,
      chapterIndex: 1,
      storyArc,
      actProgress: { 1: { consumed: ['主角失去庇护'], pending: ['反派首次施压'] } },
    } as ChapterOutlineAgentInput)

    expect(output.success).toBe(true)
    const messages = mockChat.mock.calls.at(-1)![0] as Array<{ role: string; content: string }>
    const prompt = messages.map((message) => message.content).join('\n')
    expect(prompt).toContain('conflict: true 只能用于')
    expect(prompt).toContain('不适合推进某个 mandatory beat')
  })

  it('instructs the model not to change the core event for a natural recovery opportunity', async () => {
    const agent = new ChapterOutlineAgent(createMockProvider())
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        title: '顺势推进',
        description: '主角继续处理当前冲突，不强行揭示无关线索。',
        fulfilledForeshadowIds: [],
        deferredForeshadowIds: ['fs-natural'],
      })
    )

    await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 6,
      chapterIndex: 1,
      storyArc,
      actProgress: { 1: { consumed: ['主角失去庇护'], pending: ['反派首次施压'] } },
      verifiedConstraints: ['【自然回收机会】fs-natural'],
    } as ChapterOutlineAgentInput)

    const messages = mockChat.mock.calls.at(-1)![0] as Array<{ role: string; content: string }>
    const prompt = messages.map((message) => message.content).join('\n')
    expect(prompt).toContain('【自然回收机会】')
    expect(prompt).toContain('不得为自然回收机会改变本章核心事件')
  })

  it('renders typed foreshadow obligations and a structured correction', async () => {
    const agent = new ChapterOutlineAgent(createMockProvider())
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        title: '定向修正',
        description: '本章在核心事件中完成既有线索的兑现。',
        fulfilledForeshadowIds: ['fs-hard'],
      })
    )

    await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 6,
      chapterIndex: 5,
      storyArc,
      actProgress: { 2: { consumed: [], pending: [] } },
      foreshadowObligations: [
        {
          id: 'fs-hard',
          resolutionPolicy: 'must_resolve',
          deadlineChapter: 6,
          schedulingMode: 'mandatory',
          mustFulfillThisChapter: true,
        },
      ],
      foreshadowPlanningRejection: {
        missingDeclarationIds: [],
        missingEventIds: [],
        incorrectlyDeferredIds: ['fs-hard'],
      },
    } as ChapterOutlineAgentInput)

    const messages = mockChat.mock.calls.at(-1)![0] as Array<{ role: string; content: string }>
    const prompt = messages.map((message) => message.content).join('\n')
    expect(prompt).toContain('<foreshadow_obligations>')
    expect(prompt).toContain('fs-hard')
    expect(prompt).toContain('must_resolve')
    expect(prompt).toContain('mustFulfillThisChapter=true')
    expect(prompt).toContain('<foreshadow_planning_rejection>')
    expect(prompt).toContain('incorrectlyDeferredIds: fs-hard')
  })

  it('fills empty structured declaration arrays when LLM omits them', async () => {
    const agent = new ChapterOutlineAgent(createMockProvider())
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        title: '风雨欲来',
        description: '主角在旧宅中整理遗物，发现父亲留下的一枚玉佩。',
        claimedBeats: ['主角失去庇护'],
      })
    )

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 6,
      chapterIndex: 0,
      storyArc,
      actProgress: { 1: { consumed: [], pending: ['主角失去庇护', '反派首次施压'] } },
    } as ChapterOutlineAgentInput)

    expect(output.success).toBe(true)
    const result = output.data as {
      claimedBeatIds: string[]
      fulfilledForeshadowIds: string[]
      deferredForeshadowIds: string[]
      introducedForeshadowIds: string[]
      touchedCharacterIds: string[]
      touchedItemIds: string[]
      touchedLocationIds: string[]
      resolvedTaskIds: string[]
      createdTaskIds: string[]
    }
    expect(result.claimedBeatIds).toEqual([])
    expect(result.fulfilledForeshadowIds).toEqual([])
    expect(result.deferredForeshadowIds).toEqual([])
    expect(result.introducedForeshadowIds).toEqual([])
    expect(result.touchedCharacterIds).toEqual([])
    expect(result.touchedItemIds).toEqual([])
    expect(result.touchedLocationIds).toEqual([])
    expect(result.resolvedTaskIds).toEqual([])
    expect(result.createdTaskIds).toEqual([])
  })

  it('includes beat budget in the prompt based on act progress', async () => {
    const agent = new ChapterOutlineAgent(createMockProvider())
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        title: '过渡',
        description: '主角整理线索，暂不推进新的强制节拍。',
        claimedBeats: [],
      })
    )

    await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 20,
      chapterIndex: 1,
      storyArc,
      actProgress: { 1: { consumed: ['主角失去庇护'], pending: ['反派首次施压'] } },
    } as ChapterOutlineAgentInput)

    const messages = mockChat.mock.calls.at(-1)![0] as Array<{ role: string; content: string }>
    const prompt = messages.map((message) => message.content).join('\n')
    expect(prompt).toContain('本章节拍预算')
    expect(prompt).toContain('最多承载')
  })

  it('parses deferredForeshadowIds from the LLM output', async () => {
    const agent = new ChapterOutlineAgent(createMockProvider())
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        title: '过渡',
        description: '主角在城中休整，暂不回收旧线索。',
        claimedBeats: [],
        fulfilledForeshadowIds: ['fs-a'],
        deferredForeshadowIds: ['fs-b', ''],
      })
    )

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 6,
      chapterIndex: 1,
      storyArc,
      actProgress: { 1: { consumed: ['主角失去庇护'], pending: ['反派首次施压'] } },
    } as ChapterOutlineAgentInput)

    expect(output.success).toBe(true)
    const result = output.data as {
      fulfilledForeshadowIds: string[]
      deferredForeshadowIds: string[]
    }
    expect(result.fulfilledForeshadowIds).toEqual(['fs-a'])
    expect(result.deferredForeshadowIds).toEqual(['fs-b'])
  })

  it('propagates conflict flag and reason', async () => {
    const agent = new ChapterOutlineAgent(createMockProvider())
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        title: '冲突',
        description: '主角直接与反派决战。',
        conflict: true,
        conflictReason: '当前幕不具备最终对决条件。',
      })
    )

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 6,
      chapterIndex: 0,
      storyArc,
      actProgress: { 1: { consumed: [], pending: ['主角失去庇护'] } },
    } as ChapterOutlineAgentInput)

    expect(output.success).toBe(true)
    const result = output.data as { conflict: boolean; conflictReason: string }
    expect(result.conflict).toBe(true)
    expect(result.conflictReason).toContain('最终对决')
  })

  it('includes current state snapshot when provided', async () => {
    const agent = new ChapterOutlineAgent(createMockProvider())
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        title: '过渡',
        description: '主角整理线索，暂不推进新的强制节拍。',
        claimedBeats: [],
      })
    )

    await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 6,
      chapterIndex: 1,
      storyArc,
      actProgress: { 1: { consumed: ['主角失去庇护'], pending: ['反派首次施压'] } },
      currentStateSnapshot: '【角色当前位置】\n- c-hero（主角）: 旧宅',
    } as ChapterOutlineAgentInput)

    const messages = mockChat.mock.calls.at(-1)![0] as Array<{ role: string; content: string }>
    const prompt = messages.map((message) => message.content).join('\n')
    expect(prompt).toContain('<current_state_snapshot>')
    expect(prompt).toContain('旧宅')
    expect(prompt).toContain('本章大纲必须与之一致')
  })
})
