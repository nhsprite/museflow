import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { z } from 'zod'
import { expandPath } from '../utils/paths.js'
import { getProjectConfigFilePath, getGlobalConfigFilePath } from '../utils/paths.js'
import type { AppConfig } from '../types/config.js'
import { DEFAULT_CONFIG } from '../types/config.js'

const ConfigSchema = z.object({
  model: z.object({
    provider: z.enum(['openai', 'anthropic', 'minimax', 'local'])
      .transform(v => v === 'minimax' || v === 'local' ? 'openai' : v),
    model: z.string().optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().positive().optional(),
  }),
})

function loadConfigFromPath(path: string): AppConfig | null {
  if (!existsSync(path)) {
    return null
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    const merged = deepMerge(DEFAULT_CONFIG, raw)
    return ConfigSchema.parse(merged) as AppConfig
  } catch {
    return null
  }
}

export function loadConfig(): AppConfig {
  const projectConfig = loadConfigFromPath(getProjectConfigFilePath())
  if (projectConfig) {
    return projectConfig
  }

  const globalConfig = loadConfigFromPath(getGlobalConfigFilePath())
  if (globalConfig) {
    return globalConfig
  }

  return DEFAULT_CONFIG
}

export function saveConfig(config: AppConfig): void {
  const path = getProjectConfigFilePath()
  const dir = expandPath('./.museflow')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8')
}

function deepMerge(target: unknown, source: unknown): unknown {
  if (typeof target !== 'object' || typeof source !== 'object') return source
  if (target === null || source === null) return source
  const result: Record<string, unknown> = { ...target as Record<string, unknown> }
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (key in result && typeof result[key] === 'object' && typeof value === 'object') {
      result[key] = deepMerge(result[key], value)
    } else {
      result[key] = value
    }
  }
  return result
}
