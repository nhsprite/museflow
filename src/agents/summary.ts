import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Message } from '../model/provider.js'

export class SummaryAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)
  }

  protected buildPrompt(state: AgentState): Message[] {
    return [
      this.systemMessage('你是一位故事结构分析专家，擅长从章节内容中提取关键信息。你必须提取所有角色的关键事实（说过的话、知道的信息、态度变化），这些事实将用于后续章节的一致性检查。'),
      this.userMessage(`请分析以下章节内容，生成结构化摘要：

章节标题：${state.chapterTitle ?? '未知'}
章节序号：${state.chapterIndex !== undefined ? `第${state.chapterIndex + 1}章` : '未知'}

请提取并返回以下信息（JSON格式）：
{
  "characters": ["角色名: 当前状态描述"],
  "characterFacts": [
    {
      "character": "角色名",
      "facts": [
        {
          "text": "该角色在本章中明确知道的信息/亲口说过的话/明确的态度（用第三人称客观描述）",
          "importance": "critical|major|minor"
        }
      ]
    }
  ],
  "keyEvents": [
    {
      "text": "本章发生的对后续章节有重要影响的关键事件（用第三人称客观描述）",
      "importance": "critical|major|minor"
    }
  ],
  "locations": [
    {
      "text": "地点: 描述",
      "importance": "critical|major|minor"
    }
  ],
  "keyItems": [
    {
      "text": "物品: 描述和状态",
      "importance": "critical|major|minor"
    }
  ],
  "activePlots": [
    {
      "text": "当前进行中的情节线",
      "importance": "critical|major|minor"
    }
  ],
  "mood": "本章整体氛围/情绪"
}

【重要性标注标准】
- critical（核心）：对后续章节有决定性影响，远距离章节也必须保留。例如：角色死亡、重大身份揭露、核心物品获得、关键伏笔埋下
- major（重要）：对近期章节有影响，中期距离保留。例如：角色关系变化、新能力获得、重要对话承诺
- minor（次要）：仅对本章或极近期有参考价值，远距离可丢弃。例如：场景细节描写、临时情绪反应、次要角色互动

【characterFacts 提取要求】
对于每个有台词或明确行为描写的角色，提取：
1. 该角色在本章中明确承认/知道的事实（如："主角承认信件是由中间人转交给他的"）
2. 该角色对本章关键信息的反应/态度（如："主角对来客表示欢迎，但眼神中闪过难以捉摸的神色"）
3. 该角色做出的关键承诺或威胁（如："主角警告对方天黑后不要出门"）

⚠️ 重要：你必须严格从上方提供的章节内容中提取事实，禁止编造、推测或引入内容中未出现的角色和事件。如果某个角色在本章中没有台词或明确行为，则不要为其创建 characterFacts 条目。

只返回JSON，不要其他内容。`),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (codeBlockMatch) {
      try {
        return { success: true, data: JSON.parse(codeBlockMatch[1]!.trim()) }
      } catch { }
    }
    try {
      return { success: true, data: JSON.parse(trimmed) }
    } catch {
      return { success: false, error: 'JSON解析失败' }
    }
  }
}

export function processSummaryOutput(output: AgentOutput): string | null {
  if (!output.success || !output.data) return null
  const data = output.data as Record<string, unknown>
  
  const migrateStringArrayToImportanceObjects = (arr: unknown): Array<{ text: string; importance: string }> => {
    if (!Array.isArray(arr)) return []
    return arr.map(item => {
      if (typeof item === 'string') {
        return { text: item, importance: 'major' }
      }
      return item as { text: string; importance: string }
    })
  }

  const migrateCharacterFactEntries = (arr: unknown): unknown[] => {
    if (!Array.isArray(arr)) return []
    return arr.map(entry => {
      if (!entry || typeof entry !== 'object') return entry
      const e = entry as Record<string, unknown>
      const rawFacts = e['facts']
      if (Array.isArray(rawFacts)) {
        return {
          character: e['character'],
          facts: migrateStringArrayToImportanceObjects(rawFacts),
        }
      }
      return e
    })
  }
  
  return JSON.stringify({
    characters: data['characters'] ?? [],
    characterFacts: migrateCharacterFactEntries(data['characterFacts']),
    keyEvents: migrateStringArrayToImportanceObjects(data['keyEvents']),
    locations: migrateStringArrayToImportanceObjects(data['locations']),
    keyItems: migrateStringArrayToImportanceObjects(data['keyItems']),
    activePlots: migrateStringArrayToImportanceObjects(data['activePlots']),
    mood: data['mood'] ?? '',
  })
}
