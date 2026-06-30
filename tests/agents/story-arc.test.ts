import { describe, expect, it, vi } from 'vitest'
import { StoryArcAgent } from '../../src/agents/story-arc.js'

const mockChat = vi.fn(async (): Promise<string> => '')

vi.mock('../../src/model/registry.ts', () => ({
  createProvider: () => ({
    chat: mockChat,
  }),
}))

describe('StoryArcAgent', () => {
  it('parses story arc with acts and key beats', async () => {
    const agent = new StoryArcAgent()
    mockChat.mockResolvedValueOnce(JSON.stringify({
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
        { beat: '核心秘密被主角获悉', deadlineAct: 1 },
        { beat: '最终对决', deadlineAct: 2 },
      ],
    }))

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 6,
    })

    expect(output.success).toBe(true)
    const storyArc = (output.data as { totalChapters: number; acts: unknown[]; keyBeats: unknown[] })
    expect(storyArc.totalChapters).toBe(6)
    expect(storyArc.acts).toHaveLength(2)
    expect(storyArc.keyBeats).toHaveLength(2)
  })

  it('returns empty acts when parse fails', async () => {
    const agent = new StoryArcAgent()
    mockChat.mockResolvedValueOnce('invalid json')

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 3,
    })

    expect(output.success).toBe(false)
    const data = output.data as { acts?: unknown[] } | undefined
    expect(data?.acts ?? []).toHaveLength(0)
  })

  it('normalizes missing act fields', async () => {
    const agent = new StoryArcAgent()
    mockChat.mockResolvedValueOnce(JSON.stringify({
      totalChapters: 3,
      acts: [
        { title: '第一幕' },
      ],
      keyBeats: [],
    }))

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 3,
    })

    expect(output.success).toBe(true)
    const storyArc = output.data as { acts: Array<{ index: number; mandatoryBeats: string[] }> }
    expect(storyArc.acts[0]!.index).toBe(1)
    expect(storyArc.acts[0]!.mandatoryBeats).toEqual([])
  })
})
