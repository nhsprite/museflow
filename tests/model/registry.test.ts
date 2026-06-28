import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AnthropicCompatibleProvider } from '../../src/model/registry.js'

describe('AnthropicCompatibleProvider.chatStructured', () => {
  let provider: AnthropicCompatibleProvider

  beforeEach(() => {
    provider = new AnthropicCompatibleProvider({
      apiKey: 'test-key',
      baseUrl: 'https://test.example.com',
      model: 'test-model',
    })
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockFetchResponse(content: unknown[]) {
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content }),
    } as Response)
  }

  it('returns tool_use input when available', async () => {
    mockFetchResponse([
      { type: 'tool_use', name: 'structured_response', input: { results: [true, false] } },
    ])

    const result = await provider.chatStructured<{ results: boolean[] }>(
      [{ role: 'user', content: 'test' }],
      { type: 'object', properties: { results: { type: 'array', items: { type: 'boolean' } } } },
    )

    expect(result).toEqual({ results: [true, false] })
  })

  it('falls back to parsing JSON from text content when tool_use is missing', async () => {
    mockFetchResponse([
      { type: 'text', text: '{"results": [true, false]}' },
    ])

    const result = await provider.chatStructured<{ results: boolean[] }>(
      [{ role: 'user', content: 'test' }],
      { type: 'object', properties: { results: { type: 'array', items: { type: 'boolean' } } } },
    )

    expect(result).toEqual({ results: [true, false] })
  })

  it('falls back to parsing JSON inside markdown code block', async () => {
    mockFetchResponse([
      { type: 'text', text: '```json\n{"results": [true]}\n```' },
    ])

    const result = await provider.chatStructured<{ results: boolean[] }>(
      [{ role: 'user', content: 'test' }],
      { type: 'object', properties: { results: { type: 'array', items: { type: 'boolean' } } } },
    )

    expect(result).toEqual({ results: [true] })
  })

  it('repairs malformed JSON in text content', async () => {
    mockFetchResponse([
      { type: 'text', text: "{results: [true, false],}" },
    ])

    const result = await provider.chatStructured<{ results: boolean[] }>(
      [{ role: 'user', content: 'test' }],
      { type: 'object', properties: { results: { type: 'array', items: { type: 'boolean' } } } },
    )

    expect(result).toEqual({ results: [true, false] })
  })

  it('throws an error with response preview when no usable output is found', async () => {
    mockFetchResponse([
      { type: 'text', text: 'not valid json' },
    ])

    await expect(
      provider.chatStructured<{ results: boolean[] }>(
        [{ role: 'user', content: 'test' }],
        { type: 'object', properties: { results: { type: 'array', items: { type: 'boolean' } } } },
      ),
    ).rejects.toThrow('Anthropic API did not return structured output')
  })
})
