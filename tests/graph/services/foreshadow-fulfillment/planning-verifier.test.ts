import { describe, expect, it, vi } from 'vitest'
import type { ChapterPlan } from '../../../../src/agents/types.js'
import type { ModelProvider } from '../../../../src/model/provider.js'
import { verifyForeshadowPlan } from '../../../../src/graph/services/foreshadow-fulfillment/planning-verifier.js'
import { createEmptyStoryMemory } from '../../../../src/story-memory/projector.js'
import type { ChapterOutline } from '../../../../src/types/outline.js'
import type {
  ForeshadowMemory,
  ForeshadowFulfillEvent,
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

function fulfillment(foreshadowId: string): ForeshadowFulfillEvent {
  return {
    id: `fulfill-${foreshadowId}`,
    type: 'foreshadow-fulfill',
    foreshadowId,
    chapterIndex: 3,
    source: 'chapter',
  }
}

function plan(overrides: Partial<ChapterPlan> = {}): ChapterPlan {
  return {
    chapterIndex: 3,
    sections: [],
    timeline: [],
    outlineCheck: [],
    expectedEvents: [],
    claimedMandatoryBeatIds: [],
    claimedBeatIds: [],
    fulfilledForeshadowIds: [],
    introducedForeshadowIds: [],
    resolvedTaskIds: [],
    createdTaskIds: [],
    ...overrides,
  }
}

function outline(fulfilledForeshadowIds: string[] = []): ChapterOutline {
  return {
    number: 4,
    title: '回收线索',
    description: '本章通过核心事件解释既有线索。',
    fulfilledForeshadowIds,
  }
}

function providerWithStructuredResponse(response: unknown): ModelProvider {
  return {
    chat: vi.fn(),
    chatStructured: vi.fn().mockResolvedValue(response),
  }
}

describe('verifyForeshadowPlan', () => {
  it('skips the provider when no fulfillment is claimed', async () => {
    const provider = providerWithStructuredResponse({ judgments: [] })

    const judgments = await verifyForeshadowPlan({
      provider,
      memory: memoryWithForeshadows(foreshadow('fs-a', '尚未解释的线索')),
      outline: outline(),
      plan: plan(),
      mandatoryIds: [],
    })

    expect(judgments).toEqual([])
    expect(provider.chatStructured).not.toHaveBeenCalled()
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('checks every structurally claimed ID in one call with its planted and planned context', async () => {
    const provider = providerWithStructuredResponse({
      judgments: [
        { foreshadowId: 'fs-a', verdict: 'fulfilled', reason: '规划给出了因果解释。' },
        {
          foreshadowId: 'fs-b',
          verdict: 'not_fulfilled',
          reason: '规划与原线索相矛盾。',
        },
      ],
    })
    const chapterPlan = plan({
      sections: [
        {
          title: '揭示机关',
          summary: '拆开门锁，确认内部的定时结构。',
          wordCount: 2000,
          events: ['解释门锁自行开启的原因'],
          characters: ['主角'],
        },
      ],
      fulfilledForeshadowIds: ['fs-a', 'fs-b'],
      expectedEvents: [fulfillment('fs-a'), fulfillment('fs-b')],
    })

    const judgments = await verifyForeshadowPlan({
      provider,
      memory: memoryWithForeshadows(
        {
          ...foreshadow('fs-a', '门锁会在无人触碰时打开'),
          resolutionQuestion: '门锁为何会自行打开？',
          fulfillmentCriteria: '通过可验证事件揭示触发门锁的具体机制。',
        },
        foreshadow('fs-b', '角色闭眼后灯仍持续亮着')
      ),
      outline: outline(['fs-a', 'fs-b']),
      plan: chapterPlan,
      mandatoryIds: ['fs-b'],
    })

    expect(judgments).toEqual([
      {
        foreshadowId: 'fs-a',
        verdict: 'fulfilled',
        reason: '规划给出了因果解释。',
        mandatory: false,
      },
      {
        foreshadowId: 'fs-b',
        verdict: 'not_fulfilled',
        reason: '规划与原线索相矛盾。',
        mandatory: true,
      },
    ])

    const chatStructured = vi.mocked(provider.chatStructured!)
    expect(chatStructured).toHaveBeenCalledTimes(1)
    const messages = chatStructured.mock.calls[0]?.[0]
    const prompt = messages?.map((message) => message.content).join('\n') ?? ''
    expect(prompt).toContain('门锁会在无人触碰时打开')
    expect(prompt).toContain('门锁为何会自行打开？')
    expect(prompt).toContain('通过可验证事件揭示触发门锁的具体机制。')
    expect(prompt).not.toContain('"resolutionQuestion": null')
    expect(prompt).not.toContain('"fulfillmentCriteria": null')
    expect(prompt).toContain('角色闭眼后灯仍持续亮着')
    expect(prompt).toContain('本章通过核心事件解释既有线索。')
    expect(prompt).toContain('拆开门锁，确认内部的定时结构。')
    expect(prompt).toContain('fulfill-fs-b')
  })

  it('returns an uncertain semantic judgment without upgrading it', async () => {
    const provider = providerWithStructuredResponse({
      judgments: [{ foreshadowId: 'fs-a', verdict: 'uncertain', reason: '规划细节不足。' }],
    })

    const judgments = await verifyForeshadowPlan({
      provider,
      memory: memoryWithForeshadows(foreshadow('fs-a', '尚未解释的线索')),
      outline: outline(['fs-a']),
      plan: plan({
        fulfilledForeshadowIds: ['fs-a'],
        expectedEvents: [fulfillment('fs-a')],
      }),
      mandatoryIds: [],
    })

    expect(judgments).toEqual([
      {
        foreshadowId: 'fs-a',
        verdict: 'uncertain',
        reason: '规划细节不足。',
        mandatory: false,
      },
    ])
  })

  it.each([
    ['missing id', { judgments: [] }],
    [
      'duplicate id',
      {
        judgments: [
          { foreshadowId: 'fs-a', verdict: 'fulfilled', reason: '第一次。' },
          { foreshadowId: 'fs-a', verdict: 'fulfilled', reason: '第二次。' },
        ],
      },
    ],
    [
      'unknown id',
      {
        judgments: [{ foreshadowId: 'fs-other', verdict: 'fulfilled', reason: '未知 ID。' }],
      },
    ],
    [
      'invalid verdict',
      { judgments: [{ foreshadowId: 'fs-a', verdict: 'maybe', reason: '非法枚举。' }] },
    ],
  ])('fails closed for a %s response', async (_label, response) => {
    const provider = providerWithStructuredResponse(response)

    const judgments = await verifyForeshadowPlan({
      provider,
      memory: memoryWithForeshadows(foreshadow('fs-a', '尚未解释的线索')),
      outline: outline(['fs-a']),
      plan: plan({ fulfilledForeshadowIds: ['fs-a'] }),
      mandatoryIds: ['fs-a'],
    })

    expect(judgments).toEqual([
      {
        foreshadowId: 'fs-a',
        verdict: 'verification_failed',
        reason: expect.any(String),
        mandatory: true,
      },
    ])
  })

  it('fails closed when the provider throws', async () => {
    const provider: ModelProvider = {
      chat: vi.fn(),
      chatStructured: vi.fn().mockRejectedValue(new Error('provider unavailable')),
    }

    const judgments = await verifyForeshadowPlan({
      provider,
      memory: memoryWithForeshadows(foreshadow('fs-a', '尚未解释的线索')),
      outline: outline(['fs-a']),
      plan: plan({ fulfilledForeshadowIds: ['fs-a'] }),
      mandatoryIds: [],
    })

    expect(judgments).toEqual([
      {
        foreshadowId: 'fs-a',
        verdict: 'verification_failed',
        reason: expect.stringContaining('provider unavailable'),
        mandatory: false,
      },
    ])
  })

  it('rejects a missing StoryMemory record before calling the provider', async () => {
    const provider = providerWithStructuredResponse({ judgments: [] })

    const judgments = await verifyForeshadowPlan({
      provider,
      memory: createEmptyStoryMemory(),
      outline: outline(['fs-missing']),
      plan: plan({ fulfilledForeshadowIds: ['fs-missing'] }),
      mandatoryIds: ['fs-missing'],
    })

    expect(judgments).toEqual([
      {
        foreshadowId: 'fs-missing',
        verdict: 'verification_failed',
        reason: '伏笔源记录不可用于规划验证',
        mandatory: true,
      },
    ])
    expect(provider.chatStructured).not.toHaveBeenCalled()
  })

  it('canonicalizes and deduplicates alias claims before semantic planning verification', async () => {
    const provider = providerWithStructuredResponse({
      judgments: [{ foreshadowId: 'fs-early', verdict: 'not_fulfilled', reason: '规划仍不完整。' }],
    })

    const judgments = await verifyForeshadowPlan({
      provider,
      memory: mergedMemory(),
      outline: outline(['fs-late', 'fs-early']),
      plan: plan({
        fulfilledForeshadowIds: ['fs-early', 'fs-late'],
        expectedEvents: [fulfillment('fs-late'), fulfillment('fs-early')],
      }),
      mandatoryIds: ['fs-late'],
    })

    expect(judgments).toEqual([
      {
        foreshadowId: 'fs-early',
        verdict: 'not_fulfilled',
        reason: '规划仍不完整。',
        mandatory: true,
      },
    ])

    const chatStructured = vi.mocked(provider.chatStructured!)
    expect(chatStructured).toHaveBeenCalledTimes(1)
    const prompt = chatStructured.mock.calls[0]?.[0].map((message) => message.content).join('\n')
    expect(prompt).toContain('canonical planted text')
    expect(prompt).not.toContain('duplicate planted text')
    expect(prompt?.match(/"foreshadowId": "fs-early"/g)).toHaveLength(2)
    expect(prompt).not.toContain('"foreshadowId": "fs-late"')
  })
})
