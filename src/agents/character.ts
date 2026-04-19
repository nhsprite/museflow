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
    const jsonMatch = trimmed.match(/\[[\s\S]*\]/) || trimmed.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
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
    if (!output.success || !Array.isArray(output.data)) return []
    return (output.data as Array<{
      name: string
      description?: string
      dialogueStyle?: string
      role?: string
    }>).map(char => ({
      id: generateId(),
      storyId,
      name: char.name || '未命名',
      description: char.description ?? null,
      dialogueStyle: char.dialogueStyle ?? null,
      createdAt: Date.now(),
    }))
  }
}