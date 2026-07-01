import type { ModelProvider } from '../model/provider.js'
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'
import type { AppConfig } from '../types/config.js'
import { createProvider } from '../model/registry.js'
import { getCheckpointer } from '../graph/checkpointer.js'
import { loadConfig } from '../config/store.js'

/**
 * MuseFlow 运行时上下文。
 *
 * 集中持有跨层共享的外部依赖（模型 provider、checkpoint 持久化、用户配置），
 * 避免 Agent / Core / Graph / CLI 直接访问全局 registry 或读取配置文件。
 */
export interface RuntimeContext {
  provider: ModelProvider
  checkpointer: BaseCheckpointSaver<string>
  config: AppConfig
}

/**
 * 基于当前用户配置创建运行时上下文。
 *
 * 这是 CLI 和 runner 的默认入口；单元测试应直接构造 {@link RuntimeContext}
 * 并传入 mock provider，避免触发真实的配置加载。
 */
export function createRuntimeContext(): RuntimeContext {
  const config = loadConfig()
  return {
    provider: createProvider(config),
    checkpointer: getCheckpointer(),
    config,
  }
}
