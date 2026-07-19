import { describe, expect, it, vi } from 'vitest'
import { verifyPlotAdvances } from '../../../../src/graph/services/plot-advance/semantic-verifier.js'
import type { ModelProvider } from '../../../../src/model/provider.js'
import { createEmptyStoryMemory } from '../../../../src/story-memory/projector.js'
import type { PlotAdvanceEvent, StoryMemory } from '../../../../src/types/story-memory.js'

function memoryWithBeat(beatId = 'beat-1'): StoryMemory {
  return {
    ...createEmptyStoryMemory(),
    beats: {
      [beatId]: {
        id: beatId,
        description: '角色作出不可逆的关键选择',
        actIndex: 1,
        deadlineAct: 1,
        required: true,
        claimedIn: 2,
        provenByEventIds: [],
      },
    },
  }
}

function plotAdvance(eventId: string, beatId: string, paragraphIndex = 1): PlotAdvanceEvent {
  return {
    id: eventId,
    type: 'plot-advance',
    plotId: 'plot-main',
    beatId,
    chapterIndex: 2,
    source: 'chapter',
    evidence: { paragraphIndex },
  }
}

function providerWithResponse(response: unknown): ModelProvider {
  return {
    chat: vi.fn(),
    chatStructured: vi.fn().mockResolvedValue(response),
  }
}

describe('verifyPlotAdvances', () => {
  it('skips the provider when there are no candidates', async () => {
    const provider = providerWithResponse({ judgments: [] })

    const rejections = await verifyPlotAdvances({
      provider,
      memory: memoryWithBeat(),
      chapterContent: '正文。',
      candidates: [],
    })

    expect(rejections).toEqual([])
    expect(provider.chatStructured).not.toHaveBeenCalled()
  })

  it('accepts proven events and rejects unsupported events in one structured call', async () => {
    const provider = providerWithResponse({
      judgments: [
        {
          eventId: 'evt-proven',
          beatId: 'beat-1',
          verdict: 'proven',
          reason: '证据完整实现了节拍。',
        },
        {
          eventId: 'evt-false',
          beatId: 'beat-2',
          verdict: 'not_proven',
          reason: '证据只维持了原状。',
        },
      ],
    })
    const memory = memoryWithBeat()
    memory.beats['beat-2'] = {
      ...memory.beats['beat-1']!,
      id: 'beat-2',
      description: '阶段盟友关系发生不可逆重组',
    }

    const rejections = await verifyPlotAdvances({
      provider,
      memory,
      chapterContent: '第一段完成关键选择。\n\n第二段维持原有盟友关系。',
      candidates: [plotAdvance('evt-proven', 'beat-1', 1), plotAdvance('evt-false', 'beat-2', 2)],
    })

    expect(provider.chatStructured).toHaveBeenCalledTimes(1)
    expect(rejections).toEqual([
      {
        eventId: 'evt-false',
        beatId: 'beat-2',
        evidenceParagraphIndex: 2,
        verdict: 'not_proven',
        reason: '证据只维持了原状。',
      },
    ])
    const prompt = vi
      .mocked(provider.chatStructured!)
      .mock.calls[0]?.[0].map((message) => message.content)
      .join('\n')
    expect(prompt).toContain('evt-proven')
    expect(prompt).toContain('角色作出不可逆的关键选择')
    expect(prompt).toContain('第一段完成关键选择。')
    expect(prompt).toContain('evt-false')
    expect(prompt).toContain('阶段盟友关系发生不可逆重组')
    expect(prompt).toContain('第二段维持原有盟友关系。')
  })

  it('rejects uncertain judgments', async () => {
    const provider = providerWithResponse({
      judgments: [
        {
          eventId: 'evt-uncertain',
          beatId: 'beat-1',
          verdict: 'uncertain',
          reason: '证据不足。',
        },
      ],
    })

    const rejections = await verifyPlotAdvances({
      provider,
      memory: memoryWithBeat(),
      chapterContent: '正文。',
      candidates: [plotAdvance('evt-uncertain', 'beat-1')],
    })

    expect(rejections).toEqual([
      {
        eventId: 'evt-uncertain',
        beatId: 'beat-1',
        evidenceParagraphIndex: 1,
        verdict: 'uncertain',
        reason: '证据不足。',
      },
    ])
  })

  it('fails closed for malformed structured responses', async () => {
    const provider = providerWithResponse({ judgments: [] })

    const rejections = await verifyPlotAdvances({
      provider,
      memory: memoryWithBeat(),
      chapterContent: '正文。',
      candidates: [plotAdvance('evt-1', 'beat-1')],
    })

    expect(rejections).toEqual([
      {
        eventId: 'evt-1',
        beatId: 'beat-1',
        evidenceParagraphIndex: 1,
        verdict: 'verification_failed',
        reason: expect.any(String),
      },
    ])
  })

  it('fails closed when the provider throws', async () => {
    const provider: ModelProvider = {
      chat: vi.fn(),
      chatStructured: vi.fn().mockRejectedValue(new Error('provider unavailable')),
    }

    const rejections = await verifyPlotAdvances({
      provider,
      memory: memoryWithBeat(),
      chapterContent: '正文。',
      candidates: [plotAdvance('evt-1', 'beat-1')],
    })

    expect(rejections[0]).toMatchObject({
      eventId: 'evt-1',
      beatId: 'beat-1',
      verdict: 'verification_failed',
      reason: expect.stringContaining('provider unavailable'),
    })
  })

  it('rejects unknown beats without calling the provider', async () => {
    const provider = providerWithResponse({ judgments: [] })

    const rejections = await verifyPlotAdvances({
      provider,
      memory: memoryWithBeat(),
      chapterContent: '正文。',
      candidates: [plotAdvance('evt-unknown', 'unknown-beat')],
    })

    expect(rejections).toEqual([
      {
        eventId: 'evt-unknown',
        beatId: 'unknown-beat',
        evidenceParagraphIndex: 1,
        verdict: 'verification_failed',
        reason: '节拍源记录不可用于推进验证',
      },
    ])
    expect(provider.chatStructured).not.toHaveBeenCalled()
  })
})
