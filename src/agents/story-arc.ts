import type { ModelProvider } from '../model/provider.js'
import { BaseAgent, type AgentOutput } from './base.js'
import type { StoryArcAgentInput } from './types.js'
import type { StoryArc } from '../types/outline.js'
import { parseJsonFromLLM } from '../utils/json.js'
import { buildStoryArcSystemPrompt, buildStoryArcUserPrompt } from './prompts/story-arc-prompt.js'

export class StoryArcAgent extends BaseAgent<StoryArcAgentInput> {
  constructor(provider: ModelProvider) {
    super(provider, 0.5)
  }

  protected buildPrompt(state: StoryArcAgentInput): import('../model/provider.js').Message[] {
    return [
      this.systemMessage(buildStoryArcSystemPrompt()),
      this.userMessage(buildStoryArcUserPrompt(state)),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const baseError = (message: string, error?: unknown): AgentOutput => ({
      success: false,
      content,
      error: error instanceof Error ? `${message}: ${error.message}` : message,
    })

    const parsed = parseJsonFromLLM<StoryArc>(trimmed)
    if (!parsed.success) {
      return baseError('无法解析故事弧线：JSON 格式错误')
    }

    const data = parsed.data
    if (!data || !Array.isArray(data.acts) || data.acts.length === 0) {
      return baseError('故事弧线格式错误：acts 不是有效数组')
    }
    if (typeof data.totalChapters !== 'number' || data.totalChapters < 1) {
      return baseError('故事弧线格式错误：totalChapters 无效')
    }
    if (!Array.isArray(data.keyBeats)) {
      data.keyBeats = []
    }

    const normalizedActs = data.acts.map((act, i) => ({
      index: act.index ?? i + 1,
      startChapter: act.startChapter ?? 1,
      endChapter: act.endChapter ?? data.totalChapters,
      title: act.title ?? `第 ${i + 1} 幕`,
      theme: act.theme ?? '',
      function: act.function ?? '',
      mandatoryBeats: Array.isArray(act.mandatoryBeats) ? act.mandatoryBeats : [],
    }))

    return {
      success: true,
      data: {
        totalChapters: data.totalChapters,
        acts: normalizedActs,
        keyBeats: data.keyBeats,
      },
    }
  }
}
