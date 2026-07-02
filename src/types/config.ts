export interface ModelConfig {
  provider: 'openai' | 'anthropic'
  model?: string
  apiKey?: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
}

export interface AppConfig {
  model: ModelConfig
  debug?: boolean
  autoAdjustActBoundaries?: boolean
}

export const DEFAULT_CONFIG: AppConfig = {
  model: {
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 8192,
  },
  autoAdjustActBoundaries: false,
}
