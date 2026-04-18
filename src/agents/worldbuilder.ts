import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { WorldContent } from '../graph/state.js'
import { generateId } from '../utils/id.js'

export class WorldbuilderAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.7)
  }
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const genre = this.getGenre(state.genre)
    const worldbuildingPrompt = genre?.worldbuildingPrompt ??
      `请为以下故事构建世界观设定。
故事简介：{idea}
总章节数：{totalChapters}

请以以下JSON格式返回：
{
  "title": "书名",
  "world": "世界观详细设定内容"
}`

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
    const trimmed = content.trim()
    const jsonMatch = trimmed.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) {
      return { success: true, content }
    }
    try {
      const data = JSON.parse(jsonMatch[0])
      return { success: true, data }
    } catch {
      return { success: true, content }
    }
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