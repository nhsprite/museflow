export interface ModelConfig {
  provider: 'openai' | 'anthropic'
  model?: string
  apiKey?: string
  baseUrl?: string
  /**
   * 全局温度覆盖：设置后优先于各 agent 的内置默认温度生效；
   * 不设置时各 agent 使用各自调优的默认值（创作类高温、结构化校验类低温）。
   */
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
    maxTokens: 8192,
  },
  autoAdjustActBoundaries: false,
}
