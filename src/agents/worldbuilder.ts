import type { ModelProvider } from '../model/provider.js'
import { BaseAgent, type AgentOutput } from './base.js'
import type { WorldbuilderAgentInput } from './types.js'
import type { WorldContent } from '../types/world.js'
import { generateId } from '../utils/id.js'
import { parseJsonFromLLM } from '../utils/json.js'
import {
  buildWorldbuilderSystemPrompt,
  buildWorldbuilderUserPrompt,
} from './prompts/worldbuilder-prompt.js'

export class WorldbuilderAgent extends BaseAgent<WorldbuilderAgentInput> {
  constructor(provider: ModelProvider) {
    super(provider, 0.7)
  }
  protected buildPrompt(state: WorldbuilderAgentInput): import('../model/provider.js').Message[] {
    const genre = this.getGenre(state.genre)

    return [
      this.systemMessage(buildWorldbuilderSystemPrompt()),
      this.userMessage(buildWorldbuilderUserPrompt(state, genre?.worldbuildingPrompt)),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()

    const parsed = parseJsonFromLLM<{ title?: string; world?: string; content?: string }>(trimmed)
    if (parsed.success) {
      return { success: true, data: parsed.data }
    }

    if (trimmed.length > 0) {
      return { success: true, data: { title: '', world: trimmed } }
    }

    return { success: false, error: parsed.error ?? '无法解析世界观数据：未找到 JSON 格式' }
  }

  processOutput(output: AgentOutput, storyId: string): WorldContent | null {
    if (!output.success) return null
    if (output.data && typeof output.data === 'object') {
      const obj = output.data as { title?: string; world?: string; content?: string }
      return {
        id: generateId(),
        storyId,
        content: obj.world ?? obj.content ?? '',
      }
    }
    return {
      id: generateId(),
      storyId,
      content: output.content ?? '',
    }
  }

  extractTitle(output: AgentOutput): string {
    if (output.data && typeof output.data === 'object') {
      const obj = output.data as { title?: string }
      if (obj.title) return obj.title
    }
    return ''
  }
}
