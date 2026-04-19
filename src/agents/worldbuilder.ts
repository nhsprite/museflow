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

请以以下JSON格式返回（title 为必填字段，不可省略）：
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
    console.log('[DEBUG WorldbuilderAgent] Raw AI output:', trimmed.slice(0, 2000))

    // Try to extract JSON from markdown code blocks first
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (codeBlockMatch) {
      try {
        const data = JSON.parse(codeBlockMatch[1]!.trim())
        console.log('[DEBUG WorldbuilderAgent] Parsed from code block:', JSON.stringify(data)?.slice(0, 500))
        return { success: true, data }
      } catch (e) {
        console.log('[DEBUG WorldbuilderAgent] Code block parse failed:', e)
      }
    }

    // Try direct JSON match
    const jsonMatch = trimmed.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) {
      console.log('[DEBUG WorldbuilderAgent] No JSON found')
      return { success: false, error: '无法解析世界观数据：未找到 JSON 格式' }
    }
    try {
      const data = JSON.parse(jsonMatch[0])
      console.log('[DEBUG WorldbuilderAgent] Parsed from direct match:', JSON.stringify(data)?.slice(0, 500))
      return { success: true, data }
    } catch (e) {
      console.log('[DEBUG WorldbuilderAgent] Direct JSON parse failed:', e)
      return { success: false, error: '无法解析世界观数据：JSON 格式错误' }
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