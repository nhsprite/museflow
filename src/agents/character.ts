import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Character } from '../types/character.js'
import { generateId } from '../utils/id.js'

function extractJsonArray(text: string): unknown[] | null {
  const startIdx = text.indexOf('[')
  if (startIdx === -1) return null

  let depth = 0
  let inString = false
  let escapeNext = false
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i]
    if (escapeNext) {
      escapeNext = false
      continue
    }
    if (ch === '\\') {
      escapeNext = true
      continue
    }
    if (ch === '"' && !inString) {
      inString = true
    } else if (ch === '"' && inString) {
      inString = false
    } else if (!inString) {
      if (ch === '[' || ch === '{') depth++
      else if (ch === ']' || ch === '}') {
        depth--
        if (depth === 0) {
          const slice = text.slice(startIdx, i + 1)
          try {
            const parsed = JSON.parse(slice)
            if (Array.isArray(parsed)) return parsed
          } catch {
            return null
          }
        }
      }
    }
  }
  return null
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const startIdx = text.indexOf('{')
  if (startIdx === -1) return null

  let depth = 0
  let inString = false
  let escapeNext = false
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i]
    if (escapeNext) {
      escapeNext = false
      continue
    }
    if (ch === '\\') {
      escapeNext = true
      continue
    }
    if (ch === '"' && !inString) {
      inString = true
    } else if (ch === '"' && inString) {
      inString = false
    } else if (!inString) {
      if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') {
        depth--
        if (depth === 0) {
          const slice = text.slice(startIdx, i + 1)
          try {
            const parsed = JSON.parse(slice)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              return parsed as Record<string, unknown>
            }
          } catch {
            return null
          }
        }
      }
    }
  }
  return null
}

function extractMultipleObjects(text: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = []
  let i = 0
  while (i < text.length) {
    const idx = text.indexOf('{', i)
    if (idx === -1) break
    let depth = 0
    let inString = false
    let escapeNext = false
    let found = false
    for (let j = idx; j < text.length; j++) {
      const ch = text[j]
      if (escapeNext) {
        escapeNext = false
        continue
      }
      if (ch === '\\') {
        escapeNext = true
        continue
      }
      if (ch === '"' && !inString) {
        inString = true
      } else if (ch === '"' && inString) {
        inString = false
      } else if (!inString) {
        if (ch === '{' || ch === '[') depth++
        else if (ch === '}' || ch === ']') {
          depth--
          if (depth === 0) {
            const slice = text.slice(idx, j + 1)
            try {
              const parsed = JSON.parse(slice)
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                objects.push(parsed as Record<string, unknown>)
              }
            } catch (_err) {
              void _err
            }
            i = j + 1
            found = true
            break
          }
        }
      }
    }
    if (!found) break
  }
  return objects
}

export class CharacterAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.7)
  }

  protected buildPrompt(state: AgentState, formatReminder?: string): import('../model/provider.js').Message[] {
    const titleLine = state.title ? `书名：${state.title}` : ''
    const wd = state.worldDirection
    const worldDirSection = wd
      ? `世界观方向：
${wd.cultivationSystem ? `- 修炼体系：${wd.cultivationSystem}` : ''}
- 核心冲突：${wd.coreConflict}
- 世界观特色：${wd.worldFeatures.join('、')}`
      : ''

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
  <requirement>为故事创建 3-8 个主要人物</requirement>
  <requirement>每个角色需要包含：姓名、角色定位（主角/反派/配角等）、性格特点、背景故事、在故事中的目标或动机、与其他角色的关系、对话风格</requirement>
  <requirement>请以 JSON 数组格式输出</requirement>
</requirements>

<example>
  [
    {
      "姓名": "张三",
      "角色定位": "主角",
      "性格特点": "沉稳内敛",
      "背景故事": "...",
      "在故事中的目标或动机": "...",
      "与其他角色的关系": "...",
      "对话风格": "儒雅文静"
    }
  ]
</example>
${formatReminder ?? ''}`

    const messages: import('../model/provider.js').Message[] = [
      this.systemMessage('<role>你是一位擅长人物塑造的作家，擅长创造立体、真实、有记忆点的人物角色。</role>\n<requirement>请严格按照要求的 JSON 数组格式输出，不要添加任何额外的解释文字。</requirement>'),
      this.userMessage(userContent),
    ]
    return messages
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()

    try {
      const data = JSON.parse(trimmed)
      return { success: true, data }
    } catch {
    }

    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (codeBlockMatch) {
      try {
        const data = JSON.parse(codeBlockMatch[1]!.trim())
        return { success: true, data }
      } catch {
      }
    }

    const arrayResult = extractJsonArray(trimmed)
    if (arrayResult) {
      return { success: true, data: arrayResult }
    }

    const objectResult = extractJsonObject(trimmed)
    if (objectResult) {
      return { success: true, data: [objectResult] }
    }

    const objects = extractMultipleObjects(trimmed)
    if (objects.length > 0) {
      return { success: true, data: objects }
    }

    return { success: false, error: '无法解析角色数据：JSON 格式错误', content: trimmed }
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