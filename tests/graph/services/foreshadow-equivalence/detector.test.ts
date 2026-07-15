import { describe, expect, it, vi } from 'vitest'
import {
  detectForeshadowEquivalence,
  ForeshadowEquivalenceError,
  type ForeshadowEquivalenceCandidate,
} from '../../../../src/graph/services/foreshadow-equivalence/detector.js'
import type { ModelProvider } from '../../../../src/model/provider.js'

const candidates: ForeshadowEquivalenceCandidate[] = [
  {
    id: 'fs-a',
    text: 'A promise remains unanswered.',
    kind: 'dialogue_hint',
    introducedChapter: 2,
  },
  {
    id: 'fs-b',
    text: 'The same outstanding promise is recorded again.',
    kind: 'plot',
    introducedChapter: 4,
  },
  {
    id: 'fs-c',
    text: 'A separate unanswered question remains.',
    kind: null,
    introducedChapter: 5,
  },
]

function providerWithStructuredResponse(response: unknown): ModelProvider {
  return {
    chat: vi.fn(),
    chatStructured: vi.fn().mockResolvedValue(response),
  }
}

async function captureEquivalenceError(
  promise: Promise<unknown>
): Promise<ForeshadowEquivalenceError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ForeshadowEquivalenceError)
    return error as ForeshadowEquivalenceError
  }
  throw new Error('Expected ForeshadowEquivalenceError')
}

describe('detectForeshadowEquivalence', () => {
  it('returns valid disjoint groups without changing group, ID, or reason order', async () => {
    const response = {
      groups: [
        {
          ids: ['fs-b', 'fs-a'],
          reason: '  They establish one unresolved obligation.  ',
        },
        {
          ids: ['fs-c', 'fs-d'],
          reason: 'A second audit reason.',
        },
      ],
    }
    const provider = providerWithStructuredResponse(response)
    const inputCandidates = [
      ...candidates,
      {
        id: 'fs-d',
        text: 'The separate question is recorded again.',
        kind: 'other' as const,
        introducedChapter: 6,
      },
    ]

    const groups = await detectForeshadowEquivalence({
      provider,
      candidates: inputCandidates,
    })

    expect(groups).toEqual(response.groups)
    expect(groups[0]?.reason).toBe('  They establish one unresolved obligation.  ')
  })

  it('accepts a valid empty group list', async () => {
    const provider = providerWithStructuredResponse({ groups: [] })

    await expect(detectForeshadowEquivalence({ provider, candidates })).resolves.toEqual([])
  })

  it.each([
    ['missing output root', undefined],
    ['null output root', null],
    ['array output root', []],
    ['missing groups', {}],
    ['extra root property', { groups: [], extra: true }],
    ['non-array groups', { groups: {} }],
    ['non-object group', { groups: [null] }],
    ['non-array ids', { groups: [{ ids: 'fs-a', reason: 'An audit reason.' }] }],
    ['empty ids', { groups: [{ ids: [], reason: 'An audit reason.' }] }],
    ['one id', { groups: [{ ids: ['fs-a'], reason: 'An audit reason.' }] }],
    ['non-string id', { groups: [{ ids: ['fs-a', 42], reason: 'An audit reason.' }] }],
    ['empty string id', { groups: [{ ids: ['fs-a', ''], reason: 'An audit reason.' }] }],
    [
      'duplicate id within a group',
      { groups: [{ ids: ['fs-a', 'fs-a'], reason: 'An audit reason.' }] },
    ],
    ['unknown id', { groups: [{ ids: ['fs-a', 'fs-unknown'], reason: 'An audit reason.' }] }],
    [
      'overlapping groups',
      {
        groups: [
          { ids: ['fs-a', 'fs-b'], reason: 'First audit reason.' },
          { ids: ['fs-b', 'fs-c'], reason: 'Second audit reason.' },
        ],
      },
    ],
    ['missing reason', { groups: [{ ids: ['fs-a', 'fs-b'] }] }],
    ['non-string reason', { groups: [{ ids: ['fs-a', 'fs-b'], reason: 42 }] }],
    ['empty reason', { groups: [{ ids: ['fs-a', 'fs-b'], reason: '' }] }],
    ['blank reason', { groups: [{ ids: ['fs-a', 'fs-b'], reason: '   ' }] }],
  ])('fails closed for %s', async (_label, response) => {
    const provider = providerWithStructuredResponse(response)

    await captureEquivalenceError(detectForeshadowEquivalence({ provider, candidates }))
  })

  it('rejects duplicate input candidate IDs before calling the provider', async () => {
    const provider = providerWithStructuredResponse({ groups: [] })
    const duplicatedCandidates: ForeshadowEquivalenceCandidate[] = [
      candidates[0]!,
      { ...candidates[1]!, id: candidates[0]!.id },
    ]

    await captureEquivalenceError(
      detectForeshadowEquivalence({ provider, candidates: duplicatedCandidates })
    )

    expect(provider.chatStructured).not.toHaveBeenCalled()
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('wraps native structured-provider failures and preserves their cause', async () => {
    const cause = new Error('native provider unavailable')
    const provider: ModelProvider = {
      chat: vi.fn(),
      chatStructured: vi.fn().mockRejectedValue(cause),
    }

    const error = await captureEquivalenceError(
      detectForeshadowEquivalence({ provider, candidates })
    )

    expect(error.cause).toBe(cause)
  })

  it('uses the structured fallback when chatStructured is unavailable', async () => {
    const provider: ModelProvider = {
      chat: vi.fn().mockResolvedValue(
        JSON.stringify({
          groups: [
            {
              ids: ['fs-a', 'fs-b'],
              reason: 'They establish one unresolved obligation.',
            },
          ],
        })
      ),
    }

    await expect(detectForeshadowEquivalence({ provider, candidates })).resolves.toEqual([
      {
        ids: ['fs-a', 'fs-b'],
        reason: 'They establish one unresolved obligation.',
      },
    ])
    expect(provider.chat).toHaveBeenCalledTimes(1)
  })

  it('wraps structured fallback failures and preserves their cause', async () => {
    const cause = new Error('fallback provider unavailable')
    const provider: ModelProvider = {
      chat: vi.fn().mockRejectedValue(cause),
    }

    const error = await captureEquivalenceError(
      detectForeshadowEquivalence({ provider, candidates })
    )

    expect(error.cause).toBe(cause)
  })

  it('uses a strict confidence-free schema and narrow semantic instructions', async () => {
    const provider = providerWithStructuredResponse({ groups: [] })

    await detectForeshadowEquivalence({ provider, candidates })

    const chatStructured = vi.mocked(provider.chatStructured!)
    expect(chatStructured).toHaveBeenCalledTimes(1)
    const [messages, schema, temperature] = chatStructured.mock.calls[0]!
    const contract = JSON.stringify(schema)
    const prompt = messages.map((message) => message.content).join('\n')

    expect(temperature).toBe(0)
    expect(schema).toMatchObject({
      type: 'object',
      required: ['groups'],
      additionalProperties: false,
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            required: ['ids', 'reason'],
            additionalProperties: false,
            properties: {
              reason: {
                type: 'string',
                minLength: 1,
                pattern: '\\S',
              },
            },
          },
        },
      },
    })
    expect(contract.toLowerCase()).not.toContain('confidence')
    expect(prompt.toLowerCase()).not.toContain('confidence')
    expect(prompt).toContain('解决任一条记录都会解决同一个尚未解决的叙事问题或义务')
    expect(prompt).toContain('共享实体、意象、场景、原因、因果关系或主题本身并不足以判为重复')
    expect(prompt).toContain('相关但可以独立解决的线索必须保持分离')
    expect(prompt).toContain('返回所有判定为等价的重复组')
  })

  it('rejects confidence fields instead of interpreting them', async () => {
    const provider = providerWithStructuredResponse({
      groups: [
        {
          ids: ['fs-a', 'fs-b'],
          reason: 'They establish one unresolved obligation.',
          confidence: 1,
        },
      ],
    })

    await captureEquivalenceError(detectForeshadowEquivalence({ provider, candidates }))
  })
})
