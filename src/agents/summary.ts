import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Message } from '../model/provider.js'

export class SummaryAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)  // low temperature for extraction
  }

  protected buildPrompt(state: AgentState): Message[] {
    return [
      this.systemMessage('你是一位故事结构分析专家，擅长从章节内容中提取关键信息。'),
      this.userMessage(`请分析以下章节内容，生成状态快照：

章节标题：${state.chapterTitle ?? '未知'}
章节摘要：${state.chapterSummary ?? '无'}

请提取并返回以下信息（JSON格式）：
{
  "characters": ["角色名: 当前状态描述"],
  "locations": ["地点: 描述"],
  "keyItems": ["物品: 描述"],
  "activePlots": ["当前进行中进行中的情节线"],
  "mood": "本章整体氛围/情绪"
}

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
    locations: data['locations'] ?? [],
    keyItems: data['keyItems'] ?? [],
    activePlots: data['activePlots'] ?? [],
    mood: data['mood'] ?? '',
  })
}
