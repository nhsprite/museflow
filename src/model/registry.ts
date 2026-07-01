import type { ModelProvider, Message, JsonSchema } from './provider.js'
import { getSystemMessage, getNonSystemMessages, chatStructuredFallback } from './provider.js'
import { loadConfig } from '../config/store.js'
import type { AppConfig } from '../types/config.js'
import { logger, logDebugToFile, isDebugEnabled } from '../utils/logger.js'
import { extractJsonBlock, repairMalformedJson } from '../utils/json.js'

export function createProvider(config?: AppConfig): ModelProvider {
  const resolved = config ?? loadConfig()

  const base = resolved.model.provider === 'anthropic'
    ? new AnthropicCompatibleProvider(resolved.model)
    : new OpenAICompatibleProvider(resolved.model)

  const provider = withStructuredFallback(base)

  if (isDebugEnabled() || resolved.debug) {
    return new DebugModelProvider(provider)
  }

  return provider
}

function withStructuredFallback(provider: ModelProvider): ModelProvider {
  if (provider.chatStructured) {
    return provider
  }

  return {
    chat: provider.chat.bind(provider),
    chatStructured: <T>(messages: Message[], schema: JsonSchema, temperature?: number) =>
      chatStructuredFallback<T>(provider, messages, schema, temperature),
  }
}

type ProviderConfig = { apiKey?: string; baseUrl?: string; model?: string; temperature?: number; maxTokens?: number }

const DEFAULT_FETCH_TIMEOUT_MS = 900000

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

async function fetchWithRetry(url: string, init: RequestInit, retries = 3): Promise<Response> {
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
      const isRecoverable =
        lastError.message.includes('fetch failed') ||
        lastError.message.includes('Server error') ||
        lastError.name === 'AbortError' ||
        lastError.message.includes('timeout')
      if (!isRecoverable || attempt === retries - 1) {
        logger.error(`API request failed after ${attempt + 1} attempt(s) to ${url}: ${message}`)
        if (cause) {
          logger.error(`Underlying cause: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`)
        }
        throw lastError
      }
      const delay = 1000 * 2 ** attempt
      logger.debug(`API fetch failed (attempt ${attempt + 1}/${retries}): ${message}. Retrying in ${delay}ms`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw lastError ?? new Error('Unknown fetch error')
}

class OpenAICompatibleProvider implements ModelProvider {
  constructor(private cfg: ProviderConfig) {}

  async chat(messages: Message[], temperature?: number): Promise<string> {
    const apiKey = this.cfg.apiKey ?? process.env.OPENAI_API_KEY ?? ''
    const baseUrl = this.cfg.baseUrl ?? 'https://api.openai.com/v1'
    const model = this.cfg.model ?? 'gpt-4o'
    const res = await fetchWithRetry(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: temperature ?? this.cfg.temperature ?? 0.7, max_tokens: this.cfg.maxTokens ?? 32768 }),
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    const json = await res.json() as { choices: { message: { content: string } }[] }
    return json.choices[0]?.message?.content ?? ''
  }

  async chatStructured<T>(messages: Message[], schema: JsonSchema, temperature?: number): Promise<T> {
    const apiKey = this.cfg.apiKey ?? process.env.OPENAI_API_KEY ?? ''
    const baseUrl = this.cfg.baseUrl ?? 'https://api.openai.com/v1'
    const model = this.cfg.model ?? 'gpt-4o'
    const res = await fetchWithRetry(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: temperature ?? this.cfg.temperature ?? 0.7,
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
    })
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    const json = await res.json() as { choices: { message: { content: string } }[] }
    const content = json.choices[0]?.message?.content ?? ''
    return JSON.parse(content) as T
  }
}

export class AnthropicCompatibleProvider implements ModelProvider {
  constructor(private cfg: ProviderConfig) {}

  async chat(messages: Message[], temperature?: number): Promise<string> {
    const apiKey = this.cfg.apiKey ?? process.env.ANTHROPIC_API_KEY ?? ''
    const baseUrl = this.cfg.baseUrl ?? 'https://api.anthropic.com'
    const model = this.cfg.model ?? 'claude-3-sonnet-20240229'
    const body: Record<string, unknown> = {
      model,
      messages: getNonSystemMessages(messages),
      max_tokens: this.cfg.maxTokens ?? 8192,
      temperature: temperature ?? this.cfg.temperature ?? 0.7,
    }
    const system = getSystemMessage(messages)
    if (system) {
      body.system = system
    }
    const res = await fetchWithRetry(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`)
    const json = await res.json() as { content: { type: string; text: string }[] }
    const textContent = json.content?.find(c => c.type === 'text')
    return textContent?.text ?? ''
  }

  async chatStructured<T>(messages: Message[], schema: JsonSchema, temperature?: number): Promise<T> {
    const apiKey = this.cfg.apiKey ?? process.env.ANTHROPIC_API_KEY ?? ''
    const baseUrl = this.cfg.baseUrl ?? 'https://api.anthropic.com'
    const model = this.cfg.model ?? 'claude-3-sonnet-20240229'

    const toolName = 'structured_response'
    const body: Record<string, unknown> = {
      model,
      messages: getNonSystemMessages(messages),
      max_tokens: this.cfg.maxTokens ?? 8192,
      temperature: temperature ?? this.cfg.temperature ?? 0.7,
      tools: [{
        name: toolName,
        description: 'Return structured data according to the required schema',
        input_schema: schema,
      }],
      tool_choice: { type: 'tool', name: toolName },
    }
    const system = getSystemMessage(messages)
    if (system) {
      body.system = system
    }

    const res = await fetchWithRetry(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`)
    const json = await res.json() as {
      content: Array<{ type: string; name?: string; input?: T; text?: string }>
    }
    const toolUse = json.content?.find(c => c.type === 'tool_use' && c.name === toolName)
    if (toolUse?.input) {
      return toolUse.input
    }

    // Fallback: some Anthropic-compatible endpoints (e.g., Minimax) return the
    // structured JSON inside a plain text content block instead of a tool_use block.
    const textContent = json.content?.find(c => c.type === 'text')?.text
    if (textContent) {
      const jsonText = extractJsonBlock(textContent)
      try {
        return JSON.parse(jsonText) as T
      } catch {
        try {
          return JSON.parse(repairMalformedJson(jsonText)) as T
        } catch {
          // fall through to throw with response preview
        }
      }
    }

    const responsePreview = JSON.stringify(json).slice(0, 500)
    throw new Error(`Anthropic API did not return structured output. Response preview: ${responsePreview}`)
  }
}

interface DebugSession {
  timestamp: string
  messages: Message[]
  temperature: number | undefined
  response: string
  duration_ms: number
  error?: boolean
  structured?: boolean
}

class DebugModelProvider implements ModelProvider {
  constructor(private provider: ModelProvider) {}

  async chat(messages: Message[], temperature?: number): Promise<string> {
    const start = Date.now()
    try {
      const response = await this.provider.chat(messages, temperature)
      this.log({
        timestamp: new Date().toISOString(),
        messages,
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
        temperature,
        response: errorMsg,
        duration_ms: Date.now() - start,
        error: true,
      })
      throw err
    }
  }

  async chatStructured<T>(messages: Message[], schema: JsonSchema, temperature?: number): Promise<T> {
    const start = Date.now()
    if (!this.provider.chatStructured) {
      throw new Error('Provider does not support structured output')
    }
    try {
      const response = await this.provider.chatStructured<T>(messages, schema, temperature)
      this.log({
        timestamp: new Date().toISOString(),
        messages,
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
    logger.debug(`[LLM] messages=${session.messages.length} temp=${session.temperature} duration=${session.duration_ms}ms`)

    for (const msg of session.messages) {
      const preview = msg.content.slice(0, 100).replace(/\n/g, ' ')
      logger.debug(`[LLM] ${msg.role}: ${preview}${msg.content.length > 100 ? '...' : ''}`)
    }

    const respPreview = session.response.slice(0, 200).replace(/\n/g, ' ')
    logger.debug(`[LLM] response: ${respPreview}${session.response.length > 200 ? '...' : ''}`)

    logDebugToFile(session)
  }
}
