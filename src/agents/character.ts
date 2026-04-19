import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Character } from '../types/character.js'
import { generateId } from '../utils/id.js'

export class CharacterAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.7)
  }
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const titleLine = state.title ? `书名：${state.title}` : ''
    const worldDirSection = state.worldDirection
      ? `世界观方向：
- 修炼体系：${state.worldDirection.cultivationSystem}
- 核心冲突：${state.worldDirection.coreConflict}
- 世界观特色：${state.worldDirection.worldFeatures.join('、')}`
      : ''

    const userContent = `根据以下故事设定，创建主要人物角色。

${titleLine}
故事简介：${state.idea}
${worldDirSection}
${state.world ? `世界观设定：\n${state.world}` : ''}

请为故事创建 3-8 个主要人物，每个角色需要包含：
1. 姓名
2. 角色定位（主角/反派/配角等）
3. 性格特点
4. 背景故事
5. 在故事中的目标或动机
6. 与其他角色的关系

请以 JSON 数组格式输出。`

    return [
      this.systemMessage('你是一位擅长人物塑造的作家，擅长创造立体、真实、有记忆点的人物角色。'),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    console.log('[DEBUG CharacterAgent] Raw AI output:', trimmed.slice(0, 2000))

    // Try markdown code blocks first
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (codeBlockMatch) {
      try {
        const data = JSON.parse(codeBlockMatch[1]!.trim())
        return { success: true, data }
      } catch {
      }
    }

    const jsonMatch = trimmed.match(/\[[\s\S]*?\]/) || trimmed.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) {
      console.log('[DEBUG CharacterAgent] No JSON found')
      return { success: false, error: '无法解析角色数据：未找到 JSON 格式' }
    }
    try {
      const data = JSON.parse(jsonMatch[0])
      return { success: true, data }
    } catch {
      return { success: false, error: '无法解析角色数据：JSON 格式错误' }
    }
  }

  processOutput(output: AgentOutput, storyId: string): Character[] {
    if (!output.success) {
      console.log('[DEBUG] CharacterAgent: output.success is false, error:', output.error)
      return []
    }
    if (!Array.isArray(output.data)) {
      console.log('[DEBUG] CharacterAgent: output.data is not array, data type:', typeof output.data)
      // Handle wrapping object format or Chinese field names
      if (output.data && typeof output.data === 'object') {
        const obj = output.data as Record<string, unknown>
        let chars: unknown[] = []
        if (Array.isArray(obj.characters)) {
          chars = obj.characters
        } else {
          for (const val of Object.values(obj)) {
            if (Array.isArray(val)) {
              chars = val
              break
            }
          }
        }
        if (chars.length > 0) {
          return chars.map((char: unknown) => {
            const c = char as Record<string, unknown>
            return {
              id: generateId(),
              storyId,
              name: String(c['姓名'] || c['name'] || '未命名'),
              description: (c['背景故事'] || c['description'] || null) as string | null,
              dialogueStyle: (c['对话风格'] || c['dialogueStyle'] || null) as string | null,
              createdAt: Date.now(),
            }
          })
        }
      }
      return []
    }
    return output.data.map((char: unknown) => {
      const c = char as Record<string, unknown>
      return {
        id: generateId(),
        storyId,
        name: String(c['姓名'] || c['name'] || '未命名'),
        description: (c['背景故事'] || c['description'] || null) as string | null,
        dialogueStyle: (c['对话风格'] || c['dialogueStyle'] || null) as string | null,
        createdAt: Date.now(),
      }
    })
  }
}