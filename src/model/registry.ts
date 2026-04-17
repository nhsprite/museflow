import type { ModelProvider, Message } from './provider.js'
import { loadConfig } from '../config/store.js'

export function createProvider(): ModelProvider {
  const config = loadConfig()
  switch (config.model.provider) {
    case 'openai': return new OpenAIProvider(config.model)
    case 'minimax': return new MiniMaxProvider(config.model)
    case 'local': return new LocalProvider(config.model)
  }
}

type ProviderConfig = { apiKey?: string; baseUrl?: string; model?: string; temperature?: number; maxTokens?: number }

class OpenAIProvider implements ModelProvider {
  constructor(private cfg: ProviderConfig) {}

  async chat(messages: Message[], temperature?: number): Promise<string> {
    const apiKey = this.cfg.apiKey ?? process.env.OPENAI_API_KEY ?? ''
    const baseUrl = this.cfg.baseUrl ?? 'https://api.openai.com/v1'
    const model = this.cfg.model ?? 'gpt-4o'
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: temperature ?? this.cfg.temperature ?? 0.7, max_tokens: this.cfg.maxTokens ?? 4096 }),
    })
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`)
    const json = await res.json() as { choices: { message: { content: string } }[] }
    return json.choices[0]?.message?.content ?? ''
  }
}

class MiniMaxProvider implements ModelProvider {
  constructor(private cfg: ProviderConfig) {}

  async chat(messages: Message[], temperature?: number): Promise<string> {
    const apiKey = this.cfg.apiKey ?? process.env.MINIMAX_API_KEY ?? ''
    const baseUrl = this.cfg.baseUrl ?? 'https://api.minimax.chat/v1'
    const model = this.cfg.model ?? 'abab6.5s-chat'
    const res = await fetch(`${baseUrl}/chat_completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: temperature ?? this.cfg.temperature ?? 0.7 }),
    })
    if (!res.ok) throw new Error(`MiniMax API error: ${res.status}`)
    const json = await res.json() as { choices: { message: { content: string } }[] }
    return json.choices[0]?.message?.content ?? ''
  }
}

class LocalProvider implements ModelProvider {
  constructor(private cfg: ProviderConfig) {}

  async chat(messages: Message[], temperature?: number): Promise<string> {
    const apiKey = this.cfg.apiKey ?? 'ollama'
    const baseUrl = this.cfg.baseUrl ?? 'http://localhost:11434/v1'
    const model = this.cfg.model ?? 'llama3'
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: temperature ?? this.cfg.temperature ?? 0.7 }),
    })
    if (!res.ok) throw new Error(`Local model error: ${res.status}`)
    const json = await res.json() as { choices: { message: { content: string } }[] }
    return json.choices[0]?.message?.content ?? ''
  }
}
