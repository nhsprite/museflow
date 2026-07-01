import type { ModelProvider } from '../../src/model/provider.js'
import type { RuntimeContext } from '../../src/core/context.js'
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'
import { DEFAULT_CONFIG } from '../../src/types/config.js'

export function createMockProvider(response?: string): ModelProvider {
  return {
    chat: vi.fn().mockResolvedValue(response ?? ''),
    chatStructured: vi.fn().mockResolvedValue({}),
  }
}

export function createMockContext(response?: string): RuntimeContext {
  return {
    provider: createMockProvider(response),
    checkpointer: {} as unknown as BaseCheckpointSaver<string>,
    config: DEFAULT_CONFIG,
  }
}
