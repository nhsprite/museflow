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
      "facts": ["该角色在本章中明确知道的信息/亲口说过的话/明确的态度（用第三人称客观描述）"]
    }
  ],
  "locations": ["地点: 描述"],
  "keyItems": ["物品: 描述和状态"],
  "activePlots": ["当前进行中进行中的情节线"],
  "mood": "本章整体氛围/情绪"
}

【characterFacts 提取要求】
对于每个有台词或明确行为描写的角色，提取：
1. 该角色在本章中明确承认/知道的事实（如："陆百川承认信是他从沈慕白那里收到并转交给沈惊鸿的"）
2. 该角色对本章关键信息的反应/态度（如："陆百川对沈惊鸿的到来表示欢迎，但眼神中闪过难以捉摸的神色"）
3. 该角色做出的关键承诺或威胁（如："陆百川警告沈惊鸿天黑后不要出门"）

这些事实将用于检测后续章节中角色是否"忘记"了自己知道的事情或前后言行矛盾。请确保提取的事实准确、客观、有文本依据。

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
  return JSON.stringify({
    characters: data['characters'] ?? [],
    characterFacts: data['characterFacts'] ?? [],
    locations: data['locations'] ?? [],
    keyItems: data['keyItems'] ?? [],
    activePlots: data['activePlots'] ?? [],
    mood: data['mood'] ?? '',
  })
}
