import { loadConfig, saveConfig } from '../../config/store.js'
import type { AppConfig } from '../../types/config.js'

interface ConfigOptions {
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
}

export async function config(action: string, options: ConfigOptions): Promise<void> {
  if (action === 'show') {
    const cfg = loadConfig()
    console.log('='.repeat(50))
    console.log('MuseFlow 配置')
    console.log('='.repeat(50))
    console.log('')
    console.log('模型配置:')
    console.log(`  提供商: ${cfg.model.provider}`)
    console.log(`  模型: ${cfg.model.model || '(默认)'}`)
    console.log(`  Temperature: ${cfg.model.temperature ?? '(默认)'}`)
    console.log(`  Max Tokens: ${cfg.model.maxTokens ?? '(默认)'}`)
    if (cfg.model.apiKey) {
      console.log(`  API Key: ${cfg.model.apiKey.substring(0, 8)}...`)
    }
    if (cfg.model.baseUrl) {
      console.log(`  Base URL: ${cfg.model.baseUrl}`)
    }
    console.log('')
    console.log('存储路径:')
    console.log(`  输出目录: ${cfg.outputDir}`)
    console.log(`  检查点目录: ${cfg.checkpointsDir}`)
    console.log('')
    console.log('='.repeat(50))
    console.log('')
    console.log('使用 "museflow config set --provider <name>" 修改配置')
    return
  }

  if (action === 'set') {
    const cfg = loadConfig()

    if (options.provider) {
      if (!['openai', 'minimax', 'local'].includes(options.provider)) {
        console.error('[MuseFlow] 错误: 提供商必须是 openai、minimax 或 local')
        process.exit(1)
      }
      cfg.model.provider = options.provider as 'openai' | 'minimax' | 'local'
      console.log(`[MuseFlow] 已设置提供商: ${options.provider}`)
    }

    if (options.model) {
      cfg.model.model = options.model
      console.log(`[MuseFlow] 已设置模型: ${options.model}`)
    }

    if (options.apiKey) {
      cfg.model.apiKey = options.apiKey
      console.log(`[MuseFlow] 已设置 API Key`)
    }

    if (options.baseUrl) {
      cfg.model.baseUrl = options.baseUrl
      console.log(`[MuseFlow] 已设置 Base URL: ${options.baseUrl}`)
    }

    if (!options.provider && !options.model && !options.apiKey && !options.baseUrl) {
      console.error('[MuseFlow] 错误: 请指定要设置的选项')
      console.log('用法: museflow config set --provider <name> --model <name>')
      process.exit(1)
    }

    saveConfig(cfg)
    console.log('[MuseFlow] 配置已保存')
    return
  }

  if (action === 'get') {
    const cfg = loadConfig()
    if (options.provider) {
      console.log(cfg.model.provider)
    } else if (options.model) {
      console.log(cfg.model.model || '')
    } else if (options.apiKey) {
      console.log(cfg.model.apiKey || '')
    } else if (options.baseUrl) {
      console.log(cfg.model.baseUrl || '')
    } else {
      console.error('[MuseFlow] 错误: 请指定要获取的选项')
      console.log('用法: museflow config get --provider')
    }
    return
  }

  console.error(`[MuseFlow] 错误: 未知的操作 "${action}"`)
  console.log('用法: museflow config [show|set|get]')
  process.exit(1)
}