import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AnthropicCompatibleProvider, createProvider } from '../../src/model/registry.js'
import type { AppConfig } from '../../src/types/config.js'
import * as configStore from '../../src/config/store.js'
import * as loggerModule from '../../src/utils/logger.js'
import { ModelTelemetry } from '../../src/model/telemetry.js'

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
      { type: 'object', properties: { results: { type: 'array', items: { type: 'boolean' } } } }
    )

    expect(result).toEqual({ results: [true, false] })
  })

  it('falls back to parsing JSON from text content when tool_use is missing', async () => {
    mockFetchResponse([{ type: 'text', text: '{"results": [true, false]}' }])

    const result = await provider.chatStructured<{ results: boolean[] }>(
      [{ role: 'user', content: 'test' }],
      { type: 'object', properties: { results: { type: 'array', items: { type: 'boolean' } } } }
    )

    expect(result).toEqual({ results: [true, false] })
  })

  it('falls back to parsing JSON inside markdown code block', async () => {
    mockFetchResponse([{ type: 'text', text: '```json\n{"results": [true]}\n```' }])

    const result = await provider.chatStructured<{ results: boolean[] }>(
      [{ role: 'user', content: 'test' }],
      { type: 'object', properties: { results: { type: 'array', items: { type: 'boolean' } } } }
    )

    expect(result).toEqual({ results: [true] })
  })

  it('parses JSON from Anthropic-compatible text content without a type field', async () => {
    mockFetchResponse([{ text: '```json\n{"results": [true, false]}\n```' }])

    const result = await provider.chatStructured<{ results: boolean[] }>(
      [{ role: 'user', content: 'test' }],
      { type: 'object', properties: { results: { type: 'array', items: { type: 'boolean' } } } }
    )

    expect(result).toEqual({ results: [true, false] })
  })

  it('repairs malformed JSON in text content', async () => {
    mockFetchResponse([{ type: 'text', text: '{results: [true, false],}' }])

    const result = await provider.chatStructured<{ results: boolean[] }>(
      [{ role: 'user', content: 'test' }],
      { type: 'object', properties: { results: { type: 'array', items: { type: 'boolean' } } } }
    )

    expect(result).toEqual({ results: [true, false] })
  })

  it('throws an error with response preview when no usable output is found', async () => {
    mockFetchResponse([{ type: 'text', text: 'not valid json' }])

    await expect(
      provider.chatStructured<{ results: boolean[] }>([{ role: 'user', content: 'test' }], {
        type: 'object',
        properties: { results: { type: 'array', items: { type: 'boolean' } } },
      })
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
      })
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
      })
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
    const result = await provider.chatStructured([{ role: 'user', content: 'hi' }], {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
    })

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
    await provider.chatStructured([{ role: 'user', content: 'hi' }], {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
    })

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

  it('falls back to prompt-based structured output when json_schema is rejected', async () => {
    setConfig()
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({}),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"ok": true}' } }] }),
      } as Response)

    const provider = createProvider()
    const result = await provider.chatStructured([{ role: 'user', content: 'hi' }], {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
    })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const fallbackBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(fallbackBody.response_format).toBeUndefined()
    expect(fallbackBody.messages.at(-1).content).toContain('JSON Schema')
  })

  it('does not hide authentication errors behind the structured fallback', async () => {
    setConfig()
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response)

    const provider = createProvider()
    await expect(
      provider.chatStructured([{ role: 'user', content: 'hi' }], {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
      })
    ).rejects.toThrow('API error: 401')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('records token usage, metadata and structured fallback calls', async () => {
    setConfig()
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({}),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"ok": true}' } }],
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        }),
      } as Response)
    const telemetry = new ModelTelemetry()
    const provider = createProvider(
      {
        model: {
          provider: 'openai',
          model: 'test-model',
          apiKey: 'test-key',
          baseUrl: 'https://test.example.com',
        },
      },
      telemetry
    )

    await provider.chatStructured(
      [{ role: 'user', content: 'hi' }],
      {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
      },
      0.2,
      { chapterIndex: 3, purpose: 'test-structured' }
    )

    expect(telemetry.summarizeChapter(3)).toMatchObject({
      calls: 2,
      failures: 1,
      structuredCalls: 1,
      fallbackCalls: 1,
      inputTokens: 12,
      outputTokens: 3,
      totalTokens: 15,
      usageReportedCalls: 1,
      callsByPurpose: { 'test-structured': 2 },
    })
  })

  it.each(['openai', 'anthropic'] as const)(
    'preserves %s usage when structured content cannot be parsed',
    async (providerName) => {
      setConfig()
      const telemetry = new ModelTelemetry()
      const provider = createProvider(
        {
          model: {
            provider: providerName,
            model: 'test-model',
            apiKey: 'test-key',
            baseUrl: 'https://test.example.com',
          },
        },
        telemetry
      )
      const response =
        providerName === 'openai'
          ? {
              choices: [{ message: { content: '{"truncated":' } }],
              usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
            }
          : {
              content: [{ type: 'text', text: 'unparseable response' }],
              usage: { input_tokens: 120, output_tokens: 80 },
            }
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => response,
      } as Response)

      await expect(
        provider.chatStructured!([{ role: 'user', content: 'hi' }], { type: 'object' }, 0, {
          chapterIndex: 3,
          purpose: 'test-structured',
        })
      ).rejects.toThrow()

      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      expect(telemetry.summarizeChapter(3)).toMatchObject({
        calls: 1,
        failures: 1,
        structuredCalls: 1,
        inputTokens: 120,
        outputTokens: 80,
        totalTokens: 200,
        usageReportedCalls: 1,
        callsByPurpose: { 'test-structured': 1 },
      })
    }
  )

  it('lets config temperature override call-site values', async () => {
    setConfig({ model: { temperature: 1.3 } })
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    } as Response)

    const provider = createProvider()
    await provider.chat([{ role: 'user', content: 'hi' }], 0.2)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.temperature).toBe(1.3)
  })

  it('uses the call-site temperature when config temperature is unset', async () => {
    setConfig({ model: { temperature: undefined } })
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    } as Response)

    const provider = createProvider()
    await provider.chat([{ role: 'user', content: 'hi' }], 0.2)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.temperature).toBe(0.2)
  })

  it('falls back to 0.7 when neither config nor call-site temperature is set', async () => {
    setConfig({ model: { temperature: undefined } })
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    } as Response)

    const provider = createProvider()
    await provider.chat([{ role: 'user', content: 'hi' }])

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.temperature).toBe(0.7)
  })

  it('retries on 5xx and succeeds', async () => {
    setConfig()
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
        text: async () => '',
      } as Response)
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
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({}),
      text: async () => '',
    } as Response)

    const provider = createProvider()
    await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('API error: 400')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries on network errors and succeeds', async () => {
    setConfig()
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce({
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
      })
    )
  })

  it('reads Anthropic-compatible chat text content without a type field', async () => {
    setConfig({ model: { provider: 'anthropic' } })
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: 'anthropic hello without type' }] }),
    } as Response)

    const provider = createProvider()
    const result = await provider.chat([{ role: 'user', content: 'hi' }])

    expect(result).toBe('anthropic hello without type')
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
    const result = await provider.chatStructured([{ role: 'user', content: 'hi' }], {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
    })

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
      })
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
      })
    )
  })
})
