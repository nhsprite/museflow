import { describe, expect, it, vi } from 'vitest'
import { StoryArcAgent } from '../../src/agents/story-arc.js'
import type { StoryArcAgentInput } from '../../src/agents/types.ts'
import type { ModelProvider } from '../../src/model/provider.ts'

vi.mock('../../src/utils/chapter-planning.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/chapter-planning.js')>()
  return {
    ...actual,
    getChapterPlanningConfig: (genreName: string) =>
      genreName === 'configurable-test'
        ? {
            ...actual.DEFAULT_CHAPTER_PLANNING_CONFIG,
            storyActCountMin: 2,
            storyActCountMax: 7,
          }
        : actual.getChapterPlanningConfig(genreName),
  }
})

const mockChat = vi.fn(async (): Promise<string> => '')

function createMockProvider(): ModelProvider {
  return {
    chat: mockChat,
    chatStructured: vi.fn().mockResolvedValue({}),
  }
}

describe('StoryArcAgent', () => {
  it('renders configurable act limits without fixed numeric examples', async () => {
    const agent = new StoryArcAgent(createMockProvider())
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        totalChapters: 20,
        acts: [{ index: 1, startChapter: 1, endChapter: 20 }],
        keyBeats: [],
      })
    )

    await agent.run({
      idea: 'a hero journey',
      genre: 'configurable-test',
      totalChapters: 20,
    } as StoryArcAgentInput)

    const messages = mockChat.mock.calls.at(-1)![0] as Array<{ content: string }>
    const prompt = messages.map((message) => message.content).join('\n')
    expect(prompt).toContain('划分为 2-7 幕')
    expect(prompt).not.toContain('3-5 幕')
    expect(prompt).not.toContain('"endChapter": 10')
    expect(prompt).not.toContain('"deadlineAct": 2')
  })

  it('parses story arc with acts and key beats', async () => {
    const agent = new StoryArcAgent(createMockProvider())
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
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
            mandatoryBeats: ['主角找到盟友', '双方正面交锋'],
          },
        ],
        keyBeats: [
          {
            beat: '核心秘密被主角获悉',
            deadlineAct: 1,
            coveredByMandatoryBeatId: null,
          },
          { beat: '最终对决', deadlineAct: 2, coveredByMandatoryBeatId: 'A2-M2' },
        ],
      })
    )

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 6,
    } as StoryArcAgentInput)

    expect(output.success).toBe(true)
    const storyArc = output.data as { totalChapters: number; acts: unknown[]; keyBeats: unknown[] }
    expect(storyArc.totalChapters).toBe(6)
    expect(storyArc.acts).toHaveLength(2)
    expect(storyArc.keyBeats).toHaveLength(2)
    expect(storyArc.keyBeats[0]?.id).toBeDefined()
    expect(storyArc.keyBeats[0]?.required).toBe(true)
    expect(storyArc.keyBeats[1]?.coveredByMandatoryBeatId).toBe('A2-M2')
  })

  it('returns empty acts when parse fails', async () => {
    const agent = new StoryArcAgent(createMockProvider())
    mockChat.mockResolvedValueOnce('invalid json')

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 3,
    } as StoryArcAgentInput)

    expect(output.success).toBe(false)
    const data = output.data as { acts?: unknown[] } | undefined
    expect(data?.acts ?? []).toHaveLength(0)
  })

  it('normalizes missing act fields', async () => {
    const agent = new StoryArcAgent(createMockProvider())
    mockChat.mockResolvedValueOnce(
      JSON.stringify({
        totalChapters: 3,
        acts: [{ title: '第一幕' }],
        keyBeats: [],
      })
    )

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 3,
    } as StoryArcAgentInput)

    expect(output.success).toBe(true)
    const storyArc = output.data as { acts: Array<{ index: number; mandatoryBeats: string[] }> }
    expect(storyArc.acts[0]!.index).toBe(1)
    expect(storyArc.acts[0]!.mandatoryBeats).toEqual([])
  })
})
