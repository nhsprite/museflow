export interface ModelConfig {
  provider: 'openai' | 'minimax' | 'local'
  model?: string
  apiKey?: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
}

export interface AppConfig {
  model: ModelConfig
  outputDir: string
  checkpointsDir: string
}

export const DEFAULT_CONFIG: AppConfig = {
  model: {
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 4096,
  },
  outputDir: '~/.museflow/outputs',
  checkpointsDir: '~/.museflow/checkpoints',
}
