import type { ModelProvider, Message, JsonSchema } from './provider.js'
import { getSystemMessage, getNonSystemMessages, chatStructuredFallback } from './provider.js'
import { loadConfig } from '../config/store.js'
import type { AppConfig } from '../types/config.js'
import { logger, logDebugToFile, isDebugEnabled } from '../utils/logger.js'
import { extractJsonBlock, repairMalformedJson } from '../utils/json.js'
import { ModelTelemetry, type ModelCallMetadata, type ModelUsage } from './telemetry.js'

export function createProvider(config?: AppConfig, telemetry?: ModelTelemetry): ModelProvider {
  const resolved = config ?? loadConfig()

  const base =
    resolved.model.provider === 'anthropic'
      ? new AnthropicCompatibleProvider(resolved.model, telemetry)
      : new OpenAICompatibleProvider(resolved.model, telemetry)

  const provider = withStructuredFallback(base)

  if (isDebugEnabled() || resolved.debug) {
    return new DebugModelProvider(provider)
  }

  return provider
}

class ModelApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'ModelApiError'
  }
}

function withStructuredFallback(provider: ModelProvider): ModelProvider {
  return {
    chat: provider.chat.bind(provider),
    chatStructured: async <T>(
      messages: Message[],
      schema: JsonSchema,
      temperature?: number,
      metadata?: ModelCallMetadata
    ) => {
      if (provider.chatStructured) {
        try {
          return await provider.chatStructured<T>(messages, schema, temperature, metadata)
        } catch (err) {
          const status = err instanceof ModelApiError ? err.status : undefined
          if (status !== 400 && status !== 422) throw err
          logger.warn(
            `[MuseFlow] 模型接口拒绝原生结构化输出（HTTP ${status}），本次改用 JSON Schema 提示词降级。`
          )
        }
      }
      return chatStructuredFallback<T>(provider, messages, schema, temperature, metadata)
    },
  }
}

type ProviderConfig = {
  apiKey?: string
  baseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
}

function recordModelCall(
  telemetry: ModelTelemetry | undefined,
  startedAt: number,
  metadata: ModelCallMetadata | undefined,
  structured: boolean,
  transportRetries: number,
  usage?: ModelUsage,
  error?: unknown
): void {
  telemetry?.record({
    timestamp: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    structured,
    transportRetries,
    metadata: metadata ?? {},
    ...(usage ? { usage } : {}),
    ...(error !== undefined
      ? { error: error instanceof Error ? error.message : String(error) }
      : {}),
  })
}

const DEFAULT_FETCH_TIMEOUT_MS = 900000

// 温度解析优先级：用户全局配置 > 调用点/agent 显式值 > 0.7 兜底。
// 配置通道（museflow config set --temperature）是全局覆盖；未设置时各 agent 的内置默认值生效。
function resolveTemperature(cfg: ProviderConfig, callValue: number | undefined): number {
  return cfg.temperature ?? callValue ?? 0.7
}

/** 传输层可恢复错误的结构化错误码（Node fetch 的 cause.code 等）。 */
const RECOVERABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

/** 无结构化错误码时的兜底消息标记（本函数自抛的 5xx 与底层传输错误串）。 */
const RECOVERABLE_ERROR_MARKERS = ['fetch failed', 'Server error', 'timeout'] as const

function errorCode(value: unknown): string | undefined {
  const code = (value as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' ? code : undefined
}

function isRecoverableFetchError(err: Error): boolean {
  if (err.name === 'AbortError') return true
  if (RECOVERABLE_ERROR_CODES.has(errorCode(err) ?? '')) return true
  const causeCode = errorCode((err as { cause?: unknown }).cause)
  if (causeCode !== undefined && RECOVERABLE_ERROR_CODES.has(causeCode)) return true
  return RECOVERABLE_ERROR_MARKERS.some((marker) => err.message.includes(marker))
}

function describeFetchError(err: unknown): { message: string; cause?: unknown } {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause
    const causeText = cause instanceof Error ? cause.message : String(cause ?? '')
    return {
      message: causeText ? `${err.message} (cause: ${causeText})` : err.message,
      cause,
    }
  }
  return { message: String(err) }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3,
  onRetry?: (attempt: number) => void
): Promise<Response> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, init)
      if (res.status >= 500 && res.status < 600) {
        throw new Error(`Server error: ${res.status}`)
      }
      return res
    } catch (err) {
      const { message, cause } = describeFetchError(err)
      lastError = err instanceof Error ? err : new Error(String(err))
      const isRecoverable = isRecoverableFetchError(lastError)
      if (!isRecoverable || attempt === retries - 1) {
        logger.error(`API request failed after ${attempt + 1} attempt(s) to ${url}: ${message}`)
        if (cause) {
          logger.error(
            `Underlying cause: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`
          )
        }
        throw lastError
      }
      onRetry?.(attempt + 1)
      const delay = 1000 * 2 ** attempt
      logger.debug(
        `API fetch failed (attempt ${attempt + 1}/${retries}): ${message}. Retrying in ${delay}ms`
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError ?? new Error('Unknown fetch error')
}

class OpenAICompatibleProvider implements ModelProvider {
  constructor(
    private cfg: ProviderConfig,
    private telemetry?: ModelTelemetry
  ) {}

  async chat(
    messages: Message[],
    temperature?: number,
    metadata?: ModelCallMetadata
  ): Promise<string> {
    const startedAt = Date.now()
    let transportRetries = 0
    try {
      const apiKey = this.cfg.apiKey ?? process.env.OPENAI_API_KEY ?? ''
      const baseUrl = this.cfg.baseUrl ?? 'https://api.openai.com/v1'
      const model = this.cfg.model ?? 'gpt-4o'
      const res = await fetchWithRetry(
        `${baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages,
            temperature: resolveTemperature(this.cfg, temperature),
            max_tokens: this.cfg.maxTokens ?? 32768,
          }),
          signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
        },
        3,
        () => {
          transportRetries++
        }
      )
      if (!res.ok) throw new ModelApiError(`API error: ${res.status}`, res.status)
      const json = (await res.json()) as {
        choices: { message: { content: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      }
      const usage = json.usage
        ? {
            inputTokens: json.usage.prompt_tokens,
            outputTokens: json.usage.completion_tokens,
            totalTokens: json.usage.total_tokens,
          }
        : undefined
      recordModelCall(this.telemetry, startedAt, metadata, false, transportRetries, usage)
      return json.choices[0]?.message?.content ?? ''
    } catch (err) {
      recordModelCall(this.telemetry, startedAt, metadata, false, transportRetries, undefined, err)
      throw err
    }
  }

  async chatStructured<T>(
    messages: Message[],
    schema: JsonSchema,
    temperature?: number,
    metadata?: ModelCallMetadata
  ): Promise<T> {
    const startedAt = Date.now()
    let transportRetries = 0
    let usage: ModelUsage | undefined
    try {
      const apiKey = this.cfg.apiKey ?? process.env.OPENAI_API_KEY ?? ''
      const baseUrl = this.cfg.baseUrl ?? 'https://api.openai.com/v1'
      const model = this.cfg.model ?? 'gpt-4o'
      const res = await fetchWithRetry(
        `${baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages,
            temperature: resolveTemperature(this.cfg, temperature),
            max_tokens: this.cfg.maxTokens ?? 32768,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'structured_response',
                schema,
                strict: true,
              },
            },
          }),
          signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
        },
        3,
        () => {
          transportRetries++
        }
      )
      if (!res.ok) throw new ModelApiError(`API error: ${res.status}`, res.status)
      const json = (await res.json()) as {
        choices: { message: { content: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      }
      usage = json.usage
        ? {
            inputTokens: json.usage.prompt_tokens,
            outputTokens: json.usage.completion_tokens,
            totalTokens: json.usage.total_tokens,
          }
        : undefined
      const content = json.choices[0]?.message?.content ?? ''
      const parsed = JSON.parse(content) as T
      recordModelCall(this.telemetry, startedAt, metadata, true, transportRetries, usage)
      return parsed
    } catch (err) {
      recordModelCall(this.telemetry, startedAt, metadata, true, transportRetries, usage, err)
      throw err
    }
  }
}

export class AnthropicCompatibleProvider implements ModelProvider {
  constructor(
    private cfg: ProviderConfig,
    private telemetry?: ModelTelemetry
  ) {}

  async chat(
    messages: Message[],
    temperature?: number,
    metadata?: ModelCallMetadata
  ): Promise<string> {
    const startedAt = Date.now()
    let transportRetries = 0
    try {
      const apiKey = this.cfg.apiKey ?? process.env.ANTHROPIC_API_KEY ?? ''
      const baseUrl = this.cfg.baseUrl ?? 'https://api.anthropic.com'
      const model = this.cfg.model ?? 'claude-3-sonnet-20240229'
      const body: Record<string, unknown> = {
        model,
        messages: getNonSystemMessages(messages),
        max_tokens: this.cfg.maxTokens ?? 8192,
        temperature: resolveTemperature(this.cfg, temperature),
      }
      const system = getSystemMessage(messages)
      if (system) {
        body.system = system
      }
      const res = await fetchWithRetry(
        `${baseUrl}/v1/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
        },
        3,
        () => {
          transportRetries++
        }
      )
      if (!res.ok) throw new ModelApiError(`Anthropic API error: ${res.status}`, res.status)
      const json = (await res.json()) as {
        content: Array<{ type?: string; text?: string }>
        usage?: { input_tokens?: number; output_tokens?: number }
      }
      const textContent = json.content?.find(
        (c) => typeof c.text === 'string' && (!c.type || c.type === 'text')
      )
      const usage = json.usage
        ? {
            inputTokens: json.usage.input_tokens,
            outputTokens: json.usage.output_tokens,
            totalTokens: (json.usage.input_tokens ?? 0) + (json.usage.output_tokens ?? 0),
          }
        : undefined
      recordModelCall(this.telemetry, startedAt, metadata, false, transportRetries, usage)
      return textContent?.text ?? ''
    } catch (err) {
      recordModelCall(this.telemetry, startedAt, metadata, false, transportRetries, undefined, err)
      throw err
    }
  }

  async chatStructured<T>(
    messages: Message[],
    schema: JsonSchema,
    temperature?: number,
    metadata?: ModelCallMetadata
  ): Promise<T> {
    const startedAt = Date.now()
    let transportRetries = 0
    let usage: ModelUsage | undefined
    try {
      const apiKey = this.cfg.apiKey ?? process.env.ANTHROPIC_API_KEY ?? ''
      const baseUrl = this.cfg.baseUrl ?? 'https://api.anthropic.com'
      const model = this.cfg.model ?? 'claude-3-sonnet-20240229'

      const toolName = 'structured_response'
      const body: Record<string, unknown> = {
        model,
        messages: getNonSystemMessages(messages),
        max_tokens: this.cfg.maxTokens ?? 8192,
        temperature: resolveTemperature(this.cfg, temperature),
        tools: [
          {
            name: toolName,
            description: 'Return structured data according to the required schema',
            input_schema: schema,
          },
        ],
        tool_choice: { type: 'tool', name: toolName },
      }
      const system = getSystemMessage(messages)
      if (system) {
        body.system = system
      }

      const res = await fetchWithRetry(
        `${baseUrl}/v1/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
        },
        3,
        () => {
          transportRetries++
        }
      )
      if (!res.ok) throw new ModelApiError(`Anthropic API error: ${res.status}`, res.status)
      const json = (await res.json()) as {
        content: Array<{ type?: string; name?: string; input?: T; text?: string }>
        usage?: { input_tokens?: number; output_tokens?: number }
      }
      usage = json.usage
        ? {
            inputTokens: json.usage.input_tokens,
            outputTokens: json.usage.output_tokens,
            totalTokens: (json.usage.input_tokens ?? 0) + (json.usage.output_tokens ?? 0),
          }
        : undefined
      const toolUse = json.content?.find((c) => c.type === 'tool_use' && c.name === toolName)
      if (toolUse?.input) {
        recordModelCall(this.telemetry, startedAt, metadata, true, transportRetries, usage)
        return toolUse.input
      }

      // 部分兼容接口把结构化 JSON 放在普通文本块中。
      const textContent = json.content?.find(
        (c) => typeof c.text === 'string' && (!c.type || c.type === 'text')
      )?.text
      if (textContent) {
        const jsonText = extractJsonBlock(textContent)
        try {
          const parsed = JSON.parse(jsonText) as T
          recordModelCall(this.telemetry, startedAt, metadata, true, transportRetries, usage)
          return parsed
        } catch {
          try {
            const repaired = JSON.parse(repairMalformedJson(jsonText)) as T
            recordModelCall(this.telemetry, startedAt, metadata, true, transportRetries, usage)
            return repaired
          } catch {
            // 继续抛出带响应预览的结构化输出错误。
          }
        }
      }

      const responsePreview = JSON.stringify(json).slice(0, 500)
      throw new Error(
        `Anthropic API did not return structured output. Response preview: ${responsePreview}`
      )
    } catch (err) {
      recordModelCall(this.telemetry, startedAt, metadata, true, transportRetries, usage, err)
      throw err
    }
  }
}

interface DebugSession {
  timestamp: string
  messages: Message[]
  metadata?: ModelCallMetadata
  temperature: number | undefined
  response: string
  duration_ms: number
  error?: boolean
  structured?: boolean
}

class DebugModelProvider implements ModelProvider {
  constructor(private provider: ModelProvider) {}

  async chat(
    messages: Message[],
    temperature?: number,
    metadata?: ModelCallMetadata
  ): Promise<string> {
    const start = Date.now()
    try {
      const response = await this.provider.chat(messages, temperature, metadata)
      this.log({
        timestamp: new Date().toISOString(),
        messages,
        ...(metadata ? { metadata } : {}),
        temperature,
        response,
        duration_ms: Date.now() - start,
      })
      return response
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log({
        timestamp: new Date().toISOString(),
        messages,
        ...(metadata ? { metadata } : {}),
        temperature,
        response: errorMsg,
        duration_ms: Date.now() - start,
        error: true,
      })
      throw err
    }
  }

  async chatStructured<T>(
    messages: Message[],
    schema: JsonSchema,
    temperature?: number,
    metadata?: ModelCallMetadata
  ): Promise<T> {
    const start = Date.now()
    if (!this.provider.chatStructured) {
      throw new Error('Provider does not support structured output')
    }
    try {
      const response = await this.provider.chatStructured<T>(
        messages,
        schema,
        temperature,
        metadata
      )
      this.log({
        timestamp: new Date().toISOString(),
        messages,
        ...(metadata ? { metadata } : {}),
        temperature,
        response: JSON.stringify(response),
        duration_ms: Date.now() - start,
        structured: true,
      })
      return response
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log({
        timestamp: new Date().toISOString(),
        messages,
        ...(metadata ? { metadata } : {}),
        temperature,
        response: errorMsg,
        duration_ms: Date.now() - start,
        error: true,
        structured: true,
      })
      throw err
    }
  }

  private log(session: DebugSession): void {
    logger.debug(
      `[LLM] messages=${session.messages.length} temp=${session.temperature} duration=${session.duration_ms}ms`
    )

    for (const msg of session.messages) {
      const preview = msg.content.slice(0, 100).replace(/\n/g, ' ')
      logger.debug(`[LLM] ${msg.role}: ${preview}${msg.content.length > 100 ? '...' : ''}`)
    }

    const respPreview = session.response.slice(0, 200).replace(/\n/g, ' ')
    logger.debug(`[LLM] response: ${respPreview}${session.response.length > 200 ? '...' : ''}`)

    logDebugToFile(session)
  }
}
