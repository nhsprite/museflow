import { describe, expect, it, vi } from 'vitest'
import type { ModelProvider } from '../../../../src/model/provider.js'
import { verifyForeshadowFulfillments } from '../../../../src/graph/services/foreshadow-fulfillment/semantic-verifier.js'
import { createEmptyStoryMemory } from '../../../../src/story-memory/projector.js'
import type {
  ForeshadowFulfillEvent,
  ForeshadowMemory,
  StoryMemory,
} from '../../../../src/types/story-memory.js'

function foreshadow(id: string, text: string): ForeshadowMemory {
  return {
    id,
    text,
    kind: 'plot',
    introducedIn: 1,
    expectedFulfillChapter: 4,
    fulfilledIn: null,
    resolutionPolicy: 'must_resolve',
    required: true,
    beatId: null,
  }
}

function mergedMemory(): StoryMemory {
  return memoryWithForeshadows(foreshadow('fs-early', 'canonical planted text'), {
    ...foreshadow('fs-late', 'duplicate planted text'),
    mergedInto: 'fs-early',
  })
}

function memoryWithForeshadows(...items: ForeshadowMemory[]): StoryMemory {
  return {
    ...createEmptyStoryMemory(),
    foreshadows: Object.fromEntries(items.map((item) => [item.id, item])),
  }
}

function fulfillment(
  foreshadowId: string,
  paragraphIndex: number,
  eventId = `fulfill-${foreshadowId}`
): ForeshadowFulfillEvent {
  return {
    id: eventId,
    type: 'foreshadow-fulfill',
    foreshadowId,
    chapterIndex: 4,
    source: 'chapter',
    evidence: { paragraphIndex },
  }
}

function providerWithStructuredResponse(response: unknown): ModelProvider {
  return {
    chat: vi.fn(),
    chatStructured: vi.fn().mockResolvedValue(response),
  }
}

describe('verifyForeshadowFulfillments', () => {
  it('skips the provider when there are no candidates', async () => {
    const provider = providerWithStructuredResponse({ judgments: [] })

    const rejections = await verifyForeshadowFulfillments({
      provider,
      memory: memoryWithForeshadows(foreshadow('fs-a', '一个尚未解释的细节')),
      chapterContent: '正文。',
      candidates: [],
    })

    expect(rejections).toEqual([])
    expect(provider.chatStructured).not.toHaveBeenCalled()
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('checks all candidates in one call and accepts only confirmed resolutions', async () => {
    const provider = providerWithStructuredResponse({
      judgments: [
        { foreshadowId: 'fs-a', verdict: 'fulfilled', reason: '证据给出了因果解释。' },
        {
          foreshadowId: 'fs-b',
          verdict: 'not_fulfilled',
          reason: '证据只重复了原有意象。',
        },
      ],
    })
    const chatStructured = vi.mocked(provider.chatStructured!)

    const rejections = await verifyForeshadowFulfillments({
      provider,
      memory: memoryWithForeshadows(
        foreshadow('fs-a', '门锁会在无人触碰时打开'),
        foreshadow('fs-b', '窗边持续出现相同光斑')
      ),
      chapterContent: '# 第五章\n\n第一段揭示门锁内部装有定时弹簧。\n\n第二段再次写到窗边的光斑。',
      candidates: [fulfillment('fs-a', 1), fulfillment('fs-b', 2)],
    })

    expect(chatStructured).toHaveBeenCalledTimes(1)
    expect(rejections).toEqual([
      {
        foreshadowId: 'fs-b',
        evidenceParagraphIndex: 2,
        verdict: 'not_fulfilled',
        reason: '证据只重复了原有意象。',
      },
    ])

    const messages = chatStructured.mock.calls[0]?.[0]
    const prompt = messages?.map((message) => message.content).join('\n') ?? ''
    expect(prompt).toContain('fs-a')
    expect(prompt).toContain('门锁会在无人触碰时打开')
    expect(prompt).toContain('第一段揭示门锁内部装有定时弹簧。')
    expect(prompt).toContain('fs-b')
    expect(prompt).toContain('窗边持续出现相同光斑')
    expect(prompt).toContain('第二段再次写到窗边的光斑。')
  })

  it('rejects an uncertain judgment', async () => {
    const provider = providerWithStructuredResponse({
      judgments: [
        { foreshadowId: 'fs-a', verdict: 'uncertain', reason: '证据不足以确定因果关系。' },
      ],
    })

    const rejections = await verifyForeshadowFulfillments({
      provider,
      memory: memoryWithForeshadows(foreshadow('fs-a', '一个尚未解释的细节')),
      chapterContent: '正文只再次提到这个细节。',
      candidates: [fulfillment('fs-a', 1)],
    })

    expect(rejections).toEqual([
      {
        foreshadowId: 'fs-a',
        evidenceParagraphIndex: 1,
        verdict: 'uncertain',
        reason: '证据不足以确定因果关系。',
      },
    ])
  })

  it.each([
    ['missing id', { judgments: [] }],
    [
      'duplicate id',
      {
        judgments: [
          { foreshadowId: 'fs-a', verdict: 'fulfilled', reason: '第一次判断。' },
          { foreshadowId: 'fs-a', verdict: 'fulfilled', reason: '第二次判断。' },
        ],
      },
    ],
    [
      'unknown id',
      {
        judgments: [
          { foreshadowId: 'fs-a', verdict: 'fulfilled', reason: '有效判断。' },
          { foreshadowId: 'fs-other', verdict: 'fulfilled', reason: '未知判断。' },
        ],
      },
    ],
    [
      'malformed verdict',
      {
        judgments: [{ foreshadowId: 'fs-a', verdict: 'maybe', reason: '非法枚举。' }],
      },
    ],
  ])('fails closed for %s responses', async (_label, response) => {
    const provider = providerWithStructuredResponse(response)

    const rejections = await verifyForeshadowFulfillments({
      provider,
      memory: memoryWithForeshadows(foreshadow('fs-a', '一个尚未解释的细节')),
      chapterContent: '正文。',
      candidates: [fulfillment('fs-a', 1)],
    })

    expect(rejections).toEqual([
      {
        foreshadowId: 'fs-a',
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

    const rejections = await verifyForeshadowFulfillments({
      provider,
      memory: memoryWithForeshadows(foreshadow('fs-a', '一个尚未解释的细节')),
      chapterContent: '正文。',
      candidates: [fulfillment('fs-a', 1)],
    })

    expect(rejections).toEqual([
      {
        foreshadowId: 'fs-a',
        evidenceParagraphIndex: 1,
        verdict: 'verification_failed',
        reason: expect.stringContaining('provider unavailable'),
      },
    ])
  })

  it('resolves raw alias events to one canonical candidate and keeps the first valid evidence', async () => {
    const provider = providerWithStructuredResponse({
      judgments: [{ foreshadowId: 'fs-early', verdict: 'not_fulfilled', reason: '证据尚未闭环。' }],
    })

    const rejections = await verifyForeshadowFulfillments({
      provider,
      memory: mergedMemory(),
      chapterContent: '第一段证据。\n\n第二段证据。',
      candidates: [fulfillment('fs-late', 2), fulfillment('fs-early', 1)],
    })

    expect(rejections).toEqual([
      {
        foreshadowId: 'fs-early',
        evidenceParagraphIndex: 2,
        verdict: 'not_fulfilled',
        reason: '证据尚未闭环。',
      },
    ])

    const chatStructured = vi.mocked(provider.chatStructured!)
    expect(chatStructured).toHaveBeenCalledTimes(1)
    const prompt = chatStructured.mock.calls[0]?.[0].map((message) => message.content).join('\n')
    expect(prompt).toContain('canonical planted text')
    expect(prompt).not.toContain('duplicate planted text')
    expect(prompt?.match(/"foreshadowId": "fs-early"/g)).toHaveLength(1)
    expect(prompt).not.toContain('fs-late')
    expect(prompt).toContain('第二段证据。')
    expect(prompt).not.toContain('第一段证据。')
  })

  it('uses the first structurally valid event when an earlier alias has invalid evidence', async () => {
    const provider = providerWithStructuredResponse({
      judgments: [{ foreshadowId: 'fs-early', verdict: 'fulfilled', reason: '证据完整。' }],
    })

    const rejections = await verifyForeshadowFulfillments({
      provider,
      memory: mergedMemory(),
      chapterContent: '唯一有效证据。',
      candidates: [fulfillment('fs-late', 4), fulfillment('fs-early', 1)],
    })

    expect(rejections).toEqual([])
    const prompt = vi
      .mocked(provider.chatStructured!)
      .mock.calls[0]?.[0].map((message) => message.content)
      .join('\n')
    expect(prompt).toContain('唯一有效证据。')
    expect(prompt).toContain('"evidenceParagraphIndex": 1')
  })
})
