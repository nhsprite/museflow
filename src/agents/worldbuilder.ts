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
      `<task>
  请为以下故事构建世界观设定。
</task>

<context>
  <story_idea>{idea}</story_idea>
  <total_chapters>{totalChapters}</total_chapters>
</context>

<output_format>
  请以以下JSON格式返回（title 为必填字段，不可省略）：
  {
    "title": "书名",
    "world": "世界观详细设定内容"
  }
</output_format>`

    const userContent = this.fillTemplate(worldbuildingPrompt, {
      idea: state.idea,
      totalChapters: state.totalChapters,
    })

    return [
      this.systemMessage('<role>你是一位资深的世界架构师，擅长构建细腻、真实且富有深度的世界观。</role>'),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()

    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (codeBlockMatch) {
      try {
        const data = JSON.parse(codeBlockMatch[1]!.trim())
        return { success: true, data }
      } catch {
        // ignore parse failure
      }
    }

    const jsonMatch = trimmed.match(/\{[\s\S]*?\}/)
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[0])
        return { success: true, data }
      } catch {
        // ignore parse failure
      }
    }

    if (trimmed.length > 0) {
      return { success: true, data: { title: '', world: trimmed } }
    }

    return { success: false, error: '无法解析世界观数据：未找到 JSON 格式' }
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