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
    if (!output.success || !Array.isArray(output.data) || output.data.length === 0) return []

    const parsed: Array<{
      name: string
      aliases: string[]
      isProtagonist: boolean
      description: string | null
      dialogueStyle: string | null
    }> = []

    for (const value of output.data) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const character = value as Record<string, unknown>
      if (typeof character.name !== 'string' || character.name.trim().length === 0) return []
      if (
        !Array.isArray(character.aliases) ||
        !character.aliases.every((alias) => typeof alias === 'string' && alias.trim().length > 0)
      ) {
        return []
      }
      if (typeof character.isProtagonist !== 'boolean') return []
      if (
        character.description !== undefined &&
        character.description !== null &&
        typeof character.description !== 'string'
      ) {
        return []
      }
      if (
        character.dialogueStyle !== undefined &&
        character.dialogueStyle !== null &&
        typeof character.dialogueStyle !== 'string'
      ) {
        return []
      }

      parsed.push({
        name: character.name.trim(),
        aliases: Array.from(new Set(character.aliases.map((alias) => alias.trim()))),
        isProtagonist: character.isProtagonist,
        description:
          typeof character.description === 'string' ? character.description.trim() : null,
        dialogueStyle:
          typeof character.dialogueStyle === 'string' ? character.dialogueStyle.trim() : null,
      })
    }

    if (!parsed.some((character) => character.isProtagonist)) return []

    const createdAt = Date.now()
    return parsed.map((character) => ({
      id: generateId(),
      storyId,
      ...character,
      createdAt,
    }))
  }
}
