import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AnthropicCompatibleProvider, createProvider } from '../../src/model/registry.js'
import type { AppConfig } from '../../src/types/config.js'
import * as configStore from '../../src/config/store.js'
import * as loggerModule from '../../src/utils/logger.js'

vi.mock('../../src/config/store.js', () => ({
  loadConfig: vi.fn(),
}))

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  logDebugToFile: vi.fn(),
  isDebugEnabled: vi.fn().mockReturnValue(false),
  setDebugEnabled: vi.fn(),
}))

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

describe('createProvider / OpenAICompatibleProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function setConfig(config: Partial<AppConfig> = {}) {
    vi.mocked(configStore.loadConfig).mockReturnValue({
      model: {
        provider: 'openai',
        model: 'test-model',
        apiKey: 'test-key',
        baseUrl: 'https://test.example.com',
        temperature: 0.7,
        maxTokens: 1000,
        ...config.model,
      },
      debug: config.debug ?? false,
    } as AppConfig)
  }

  function mockFetchResponse(response: Response | (() => Promise<Response>)) {
    const fetchMock = vi.mocked(globalThis.fetch)
    if (typeof response === 'function') {
      fetchMock.mockImplementation(response)
    } else {
      fetchMock.mockResolvedValue(response)
    }
  }

  it('returns assistant content from OpenAI chat', async () => {
    setConfig()
    mockFetchResponse({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'hello' } }] }),
    } as Response)

    const provider = createProvider()
    const result = await provider.chat([{ role: 'user', content: 'hi' }])

    expect(result).toBe('hello')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://test.example.com/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    )
  })

  it('returns empty string when OpenAI content is missing', async () => {
    setConfig()
    mockFetchResponse({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: {} }] }),
    } as Response)

    const provider = createProvider()
    const result = await provider.chat([{ role: 'user', content: 'hi' }])

    expect(result).toBe('')
  })

  it('throws API error on non-2xx OpenAI response', async () => {
    setConfig()
    mockFetchResponse({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    } as Response)

    const provider = createProvider()
    await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('API error: 401')
  })

  it('falls back to OPENAI_API_KEY env var when config apiKey is missing', async () => {
    setConfig({ model: { apiKey: undefined } })
    vi.stubEnv('OPENAI_API_KEY', 'env-key')
    mockFetchResponse({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    } as Response)

    const provider = createProvider()
    await provider.chat([{ role: 'user', content: 'hi' }])

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer env-key' }),
      }),
    )
  })

  it('returns parsed JSON from OpenAI structured chat', async () => {
    setConfig()
    mockFetchResponse({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"ok": true}' } }] }),
    } as Response)

    const provider = createProvider()
    const result = await provider.chatStructured(
      [{ role: 'user', content: 'hi' }],
      { type: 'object', properties: { ok: { type: 'boolean' } } },
    )

    expect(result).toEqual({ ok: true })
  })

  it('sends json_schema with strict true for OpenAI structured chat', async () => {
    setConfig()
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{}' } }] }),
    } as Response)

    const provider = createProvider()
    await provider.chatStructured(
      [{ role: 'user', content: 'hi' }],
      { type: 'object', properties: { ok: { type: 'boolean' } } },
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'structured_response',
        schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
        strict: true,
      },
    })
  })

  it('retries on 5xx and succeeds', async () => {
    setConfig()
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}), text: async () => '' } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      } as Response)

    const provider = createProvider()
    const result = await provider.chat([{ role: 'user', content: 'hi' }])

    expect(result).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry on 4xx errors', async () => {
    setConfig()
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({}), text: async () => '' } as Response)

    const provider = createProvider()
    await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('API error: 400')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries on network errors and succeeds', async () => {
    setConfig()
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      } as Response)

    const provider = createProvider()
    const result = await provider.chat([{ role: 'user', content: 'hi' }])

    expect(result).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws after max retries on persistent network errors', async () => {
    setConfig()
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const provider = createProvider()
    await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('fetch failed')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('createProvider provider selection', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function setConfig(config: Partial<AppConfig> = {}) {
    vi.mocked(configStore.loadConfig).mockReturnValue({
      model: {
        provider: 'openai',
        model: 'test-model',
        apiKey: 'test-key',
        baseUrl: 'https://test.example.com',
        temperature: 0.7,
        maxTokens: 1000,
        ...config.model,
      },
      debug: config.debug ?? false,
    } as AppConfig)
  }

  it('uses AnthropicCompatibleProvider for anthropic config', async () => {
    setConfig({ model: { provider: 'anthropic' } })
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: 'anthropic hello' }] }),
    } as Response)

    const provider = createProvider()
    const result = await provider.chat([{ role: 'user', content: 'hi' }])

    expect(result).toBe('anthropic hello')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://test.example.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'x-api-key': 'test-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    )
  })

  it('uses AnthropicCompatibleProvider structured output via tool_use', async () => {
    setConfig({ model: { provider: 'anthropic' } })
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'tool_use', name: 'structured_response', input: { ok: true } }],
      }),
    } as Response)

    const provider = createProvider()
    const result = await provider.chatStructured(
      [{ role: 'user', content: 'hi' }],
      { type: 'object', properties: { ok: { type: 'boolean' } } },
    )

    expect(result).toEqual({ ok: true })
  })
})

describe('DebugModelProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function setConfig(config: Partial<AppConfig> = {}) {
    vi.mocked(configStore.loadConfig).mockReturnValue({
      model: {
        provider: 'openai',
        model: 'test-model',
        apiKey: 'test-key',
        baseUrl: 'https://test.example.com',
        temperature: 0.7,
        maxTokens: 1000,
        ...config.model,
      },
      debug: config.debug ?? false,
    } as AppConfig)
  }

  it('logs session when config.debug is true', async () => {
    setConfig({ debug: true })
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'logged hello' } }] }),
    } as Response)

    const provider = createProvider()
    const result = await provider.chat([{ role: 'user', content: 'hi' }])

    expect(result).toBe('logged hello')
    expect(loggerModule.logger.debug).toHaveBeenCalled()
    expect(loggerModule.logDebugToFile).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'hi' }],
        response: 'logged hello',
      }),
    )
  })

  it('logs error and rethrows when chat fails', async () => {
    setConfig({ debug: true })
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('network down'))

    const provider = createProvider()
    await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('network down')

    expect(loggerModule.logDebugToFile).toHaveBeenCalledWith(
      expect.objectContaining({
        error: true,
      }),
    )
  })
})
