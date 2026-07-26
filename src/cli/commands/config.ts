import { existsSync } from 'node:fs'
import { loadConfig, saveConfig } from '../../config/store.js'
import { getProjectConfigFilePath, getGlobalConfigFilePath } from '../../utils/paths.js'

interface ConfigOptions {
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  autoAdjustActBoundaries?: string
}

function getConfigSource(): { source: string; path: string } {
  const projectPath = getProjectConfigFilePath()
  if (existsSync(projectPath)) {
    return { source: '项目级', path: projectPath }
  }
  const globalPath = getGlobalConfigFilePath()
  if (existsSync(globalPath)) {
    return { source: '全局', path: globalPath }
  }
  return { source: '默认', path: projectPath }
}

export async function config(action: string, options: ConfigOptions): Promise<void> {
  if (action === 'show') {
    const cfg = loadConfig()
    const { source, path } = getConfigSource()
    console.log('='.repeat(50))
    console.log('MuseFlow 配置')
    console.log('='.repeat(50))
    console.log('')
    console.log(`配置来源: ${source}`)
    console.log(`配置文件: ${path}`)
    console.log('')
    console.log('模型配置:')
    console.log(`  协议: ${cfg.model.provider}`)
    console.log(`  模型: ${cfg.model.model || '(默认)'}`)
    console.log(`  Temperature: ${cfg.model.temperature ?? '(未设置，各 agent 使用内置默认值)'}`)
    console.log(`  Max Tokens: ${cfg.model.maxTokens ?? '(默认)'}`)
    if (cfg.model.apiKey) {
      console.log(`  API Key: ${cfg.model.apiKey.substring(0, 8)}...`)
    }
    if (cfg.model.baseUrl) {
      console.log(`  Base URL: ${cfg.model.baseUrl}`)
    }
    console.log('')
    console.log('其他配置:')
    console.log(`  自动调整幕边界: ${cfg.autoAdjustActBoundaries ?? false}`)
    console.log('')
    console.log('='.repeat(50))
    console.log('')
    console.log('使用 "museflow config set --provider <name>" 修改配置')
    return
  }

  if (action === 'set') {
    const cfg = loadConfig()

    if (options.provider) {
      const validProtocols = ['openai', 'anthropic', 'minimax', 'local']
      if (!validProtocols.includes(options.provider)) {
        console.error(`[MuseFlow] 错误: 协议必须是 ${validProtocols.join('、')}`)
        process.exit(1)
      }
      // minimax/local use the OpenAI-compatible provider with custom baseUrl/model.
      cfg.model.provider = (
        options.provider === 'minimax' || options.provider === 'local' ? 'openai' : options.provider
      ) as 'openai' | 'anthropic'
      console.log(`[MuseFlow] 已设置协议: ${options.provider}`)
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

    if (options.autoAdjustActBoundaries !== undefined) {
      const value = options.autoAdjustActBoundaries.toLowerCase()
      if (value !== 'true' && value !== 'false') {
        console.error('[MuseFlow] 错误: --auto-adjust-act-boundaries 必须是 true 或 false')
        process.exit(1)
      }
      cfg.autoAdjustActBoundaries = value === 'true'
      console.log(`[MuseFlow] 已设置自动调整幕边界: ${cfg.autoAdjustActBoundaries}`)
    }

    if (
      !options.provider &&
      !options.model &&
      !options.apiKey &&
      !options.baseUrl &&
      options.autoAdjustActBoundaries === undefined
    ) {
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
    } else if (options.autoAdjustActBoundaries !== undefined) {
      console.log(String(cfg.autoAdjustActBoundaries ?? false))
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
