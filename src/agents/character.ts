import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Character } from '../types/character.js'
import { generateId } from '../utils/id.js'
import { parseJsonFromLLM } from '../utils/json.js'

export class CharacterAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.7)
  }

  protected buildPrompt(state: AgentState, formatReminder?: string): import('../model/provider.js').Message[] {
    const titleLine = state.title ? `书名：${state.title}` : ''
    const wd = state.worldDirection
    const worldDirSection = wd
      ? `世界观方向：
${wd.powerSystem ? `- 力量/规则体系：${wd.powerSystem}` : ''}
- 核心冲突：${wd.coreConflict}
- 世界观特色：${wd.worldFeatures.join('、')}`
      : ''

    const genreSkill = this.getGenre(state.genre ?? 'default')
    const mainCharacterCountMin = genreSkill?.mainCharacterCountMin ?? 3
    const mainCharacterCountMax = genreSkill?.mainCharacterCountMax ?? 8

    const userContent = `<task>
  根据以下故事设定，创建主要人物角色。
</task>

<context>
  ${titleLine ? `<title>${state.title}</title>` : ''}
  <story_idea>${state.idea}</story_idea>
  ${worldDirSection ? `<world_direction>\n${worldDirSection}\n</world_direction>` : ''}
  ${state.world ? `<world_setting>\n${state.world}\n</world_setting>` : ''}
</context>

<requirements>
  <requirement>为故事创建 {MAIN_CHARACTER_COUNT_MIN}-{MAIN_CHARACTER_COUNT_MAX} 个主要人物</requirement>
  <requirement>每个角色需要包含：姓名、角色定位（主角/反派/配角等）、性格特点、背景故事、在故事中的目标或动机、与其他角色的关系、对话风格</requirement>
  <requirement>请以 JSON 数组格式输出</requirement>
</requirements>
${formatReminder ?? ''}`

    const templatedContent = this.fillTemplate(userContent, {
      MAIN_CHARACTER_COUNT_MIN: mainCharacterCountMin,
      MAIN_CHARACTER_COUNT_MAX: mainCharacterCountMax,
    })

    const messages: import('../model/provider.js').Message[] = [
      this.systemMessage('<role>你是一位擅长人物塑造的作家，擅长创造立体、真实、有记忆点的人物角色。</role>\n<requirement>请严格按照要求的 JSON 数组格式输出，不要添加任何额外的解释文字。</requirement>'),
      this.userMessage(templatedContent),
    ]
    return messages
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()

    const parsed = parseJsonFromLLM<unknown>(trimmed)
    if (parsed.success) {
      return { success: true, data: parsed.data }
    }

    return { success: false, error: parsed.error ?? '无法解析角色数据：JSON 格式错误', content: trimmed }
  }

  processOutput(output: AgentOutput, storyId: string): Character[] {
    if (!output.success) {
      return []
    }
    if (!Array.isArray(output.data)) {
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