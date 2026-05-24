import type { ModelProvider, Message, JsonSchema } from './provider.js'
import { getSystemMessage, getNonSystemMessages, chatStructuredFallback } from './provider.js'
import { loadConfig } from '../config/store.js'

export function createProvider(): ModelProvider {
  const config = loadConfig()

  const base = config.model.provider === 'anthropic'
    ? new AnthropicCompatibleProvider(config.model)
    : new OpenAICompatibleProvider(config.model)

  return withStructuredFallback(base)
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

class OpenAICompatibleProvider implements ModelProvider {
  constructor(private cfg: ProviderConfig) {}

  async chat(messages: Message[], temperature?: number): Promise<string> {
    const apiKey = this.cfg.apiKey ?? process.env.OPENAI_API_KEY ?? ''
    const baseUrl = this.cfg.baseUrl ?? 'https://api.openai.com/v1'
    const model = this.cfg.model ?? 'gpt-4o'
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: temperature ?? this.cfg.temperature ?? 0.7, max_tokens: this.cfg.maxTokens ?? 32768 }),
      signal: AbortSignal.timeout(300000),
    })
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    const json = await res.json() as { choices: { message: { content: string } }[] }
    return json.choices[0]?.message?.content ?? ''
  }

  async chatStructured<T>(messages: Message[], schema: JsonSchema, temperature?: number): Promise<T> {
    const apiKey = this.cfg.apiKey ?? process.env.OPENAI_API_KEY ?? ''
    const baseUrl = this.cfg.baseUrl ?? 'https://api.openai.com/v1'
    const model = this.cfg.model ?? 'gpt-4o'
    const res = await fetch(`${baseUrl}/chat/completions`, {
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
      signal: AbortSignal.timeout(300000),
    })
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    const json = await res.json() as { choices: { message: { content: string } }[] }
    const content = json.choices[0]?.message?.content ?? ''
    return JSON.parse(content) as T
  }
}

class AnthropicCompatibleProvider implements ModelProvider {
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
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000),
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

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000),
    })
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`)
    const json = await res.json() as {
      content: Array<{ type: string; name?: string; input?: T }>
    }
    const toolUse = json.content?.find(c => c.type === 'tool_use' && c.name === toolName)
    if (!toolUse?.input) {
      throw new Error('Anthropic API did not return structured output')
    }
    return toolUse.input
  }
}
