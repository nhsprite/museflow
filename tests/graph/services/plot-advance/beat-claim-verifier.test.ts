import { describe, expect, it, vi } from 'vitest'
import { verifyBeatClaims } from '../../../../src/graph/services/plot-advance/beat-claim-verifier.js'
import type { ModelProvider } from '../../../../src/model/provider.js'

function providerWithResponse(response: unknown): ModelProvider {
  return {
    chat: vi.fn(),
    chatStructured: vi.fn().mockResolvedValue(response),
  }
}

const CLAIMS = [
  { beatId: 'A5-M1', beat: '凡间仇局的最终清算' },
  { beatId: 'A5-M2', beat: '三界博弈的关键真相全面揭开' },
]

describe('verifyBeatClaims', () => {
  it('skips the provider when there are no claims or no description', async () => {
    const provider = providerWithResponse({ judgments: [] })

    await expect(
      verifyBeatClaims({ provider, claims: [], outlineDescription: '大纲描述。' })
    ).resolves.toEqual([])
    await expect(
      verifyBeatClaims({ provider, claims: CLAIMS, outlineDescription: '  ' })
    ).resolves.toEqual([])
    expect(provider.chatStructured).not.toHaveBeenCalled()
  })

  it('returns rejections only for not_realized claims and passes claims to the prompt', async () => {
    const provider = providerWithResponse({
      judgments: [
        { beatId: 'A5-M1', verdict: 'realized', reason: '描述写出了清算行动。' },
        { beatId: 'A5-M2', verdict: 'not_realized', reason: '描述只有静守，没有真相揭开。' },
      ],
    })

    const rejections = await verifyBeatClaims({
      provider,
      claims: CLAIMS,
      outlineDescription: '二人在东厢静守至天明，随后升堂批文。',
    })

    expect(provider.chatStructured).toHaveBeenCalledTimes(1)
    expect(rejections).toEqual([
      {
        beatId: 'A5-M2',
        beat: '三界博弈的关键真相全面揭开',
        reason: '描述只有静守，没有真相揭开。',
      },
    ])
    const prompt = vi
      .mocked(provider.chatStructured!)
      .mock.calls[0]?.[0].map((message) => message.content)
      .join('\n')
    expect(prompt).toContain('A5-M1')
    expect(prompt).toContain('凡间仇局的最终清算')
    expect(prompt).toContain('A5-M2')
    expect(prompt).toContain('二人在东厢静守至天明，随后升堂批文。')
  })

  it('fails open when the provider throws', async () => {
    const provider: ModelProvider = {
      chat: vi.fn(),
      chatStructured: vi.fn().mockRejectedValue(new Error('provider unavailable')),
    }

    await expect(
      verifyBeatClaims({ provider, claims: CLAIMS, outlineDescription: '大纲描述。' })
    ).resolves.toEqual([])
  })

  it('fails open when a judgment is missing', async () => {
    const provider = providerWithResponse({
      judgments: [{ beatId: 'A5-M1', verdict: 'realized', reason: 'ok' }],
    })

    await expect(
      verifyBeatClaims({ provider, claims: CLAIMS, outlineDescription: '大纲描述。' })
    ).resolves.toEqual([])
  })

  it('fails open for duplicate or unknown beatIds', async () => {
    const duplicated = providerWithResponse({
      judgments: [
        { beatId: 'A5-M1', verdict: 'realized', reason: 'ok' },
        { beatId: 'A5-M1', verdict: 'not_realized', reason: 'dup' },
      ],
    })
    await expect(
      verifyBeatClaims({ provider: duplicated, claims: CLAIMS, outlineDescription: '大纲描述。' })
    ).resolves.toEqual([])

    const unknown = providerWithResponse({
      judgments: [
        { beatId: 'A5-M1', verdict: 'realized', reason: 'ok' },
        { beatId: 'A9-M9', verdict: 'not_realized', reason: 'unknown' },
      ],
    })
    await expect(
      verifyBeatClaims({ provider: unknown, claims: CLAIMS, outlineDescription: '大纲描述。' })
    ).resolves.toEqual([])
  })

  it('falls back to chatStructuredFallback when the provider lacks chatStructured', async () => {
    const provider: ModelProvider = {
      chat: vi
        .fn()
        .mockResolvedValue(
          '```json\n{"judgments":[{"beatId":"A5-M1","verdict":"realized","reason":"ok"},{"beatId":"A5-M2","verdict":"not_realized","reason":"未呈现"}]}\n```'
        ),
    }

    const rejections = await verifyBeatClaims({
      provider,
      claims: CLAIMS,
      outlineDescription: '大纲描述。',
    })

    expect(provider.chat).toHaveBeenCalledTimes(1)
    expect(rejections).toEqual([
      { beatId: 'A5-M2', beat: '三界博弈的关键真相全面揭开', reason: '未呈现' },
    ])
  })
})
