import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { WorldContent } from '../graph/state.js'
import { generateId } from '../utils/id.js'

export class WorldbuilderAgent extends BaseAgent {
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const genre = this.getGenre(state.genre)
    const worldbuildingPrompt = genre?.worldbuildingPrompt ??
      `请为以下故事构建世界观设定。
故事简介：{idea}
总章节数：{totalChapters}`

    const userContent = this.fillTemplate(worldbuildingPrompt, {
      idea: state.idea,
      totalChapters: state.totalChapters,
    })

    return [
      this.systemMessage('你是一位资深的世界架构师，擅长构建细腻、真实且富有深度的世界观。'),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    return { success: true, content }
  }

  processOutput(output: AgentOutput, storyId: string): WorldContent | null {
    if (!output.success || !output.content) return null
    return {
      id: generateId(),
      storyId,
      content: output.content,
    }
  }
}