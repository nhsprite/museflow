import type { ModelProvider, Message } from './provider.js'
import { getSystemMessage, getNonSystemMessages } from './provider.js'
import { loadConfig } from '../config/store.js'

export function createProvider(): ModelProvider {
  const config = loadConfig()

  switch (config.model.provider) {
    case 'anthropic': return new AnthropicCompatibleProvider(config.model)
    default: return new OpenAICompatibleProvider(config.model)
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
}
