import type { ModelProvider } from '../model/provider.js'
import { BaseAgent, type AgentOutput } from './base.js'
import type { CharacterAgentInput } from './types.js'
import type { Character } from '../types/character.js'
import { generateId } from '../utils/id.js'
import { parseJsonFromLLM } from '../utils/json.js'
import { buildCharacterSystemPrompt, buildCharacterUserPrompt } from './prompts/character-prompt.js'

export class CharacterAgent extends BaseAgent<CharacterAgentInput> {
  constructor(provider: ModelProvider) {
    super(provider, 0.7)
  }

  protected buildPrompt(
    state: CharacterAgentInput,
    formatReminder?: string
  ): import('../model/provider.js').Message[] {
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

    const messages: import('../model/provider.js').Message[] = [
      this.systemMessage(buildCharacterSystemPrompt()),
      this.userMessage(
        buildCharacterUserPrompt(
          state,
          mainCharacterCountMin,
          mainCharacterCountMax,
          worldDirSection,
          formatReminder
        )
      ),
    ]
    return messages
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()

    const parsed = parseJsonFromLLM<unknown>(trimmed)
    if (parsed.success) {
      return { success: true, data: parsed.data }
    }

    return {
      success: false,
      error: parsed.error ?? '无法解析角色数据：JSON 格式错误',
      content: trimmed,
    }
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
