import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { ChapterOutline } from '../graph/state.js'
import { generateId } from '../utils/id.js'

export class OutlineAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.5)
  }
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const genre = this.getGenre(state.genre)
    const outlineTemplate = genre?.outlineTemplate ??
      `根据以下信息，为一部 {totalChapters} 章的小说制定大纲。
故事简介：{idea}

请按章节顺序列出每一章的：
- 章节标题
- 本章核心事件
- 预计篇幅

严格生成 exactly {totalChapters} 个章节。`

    const userContent = this.fillTemplate(outlineTemplate, {
      idea: state.idea,
      totalChapters: state.totalChapters,
    })

    const context = `
世界观设定：
${state.world || '（尚未构建）'}

人物设定：
${state.characters || '（尚未创建）'}

${userContent}

重要提醒：必须严格生成 exactly ${state.totalChapters} 个章节，不能多也不能少。`

    return [
      this.systemMessage('你是一位擅长故事结构的大纲设计师，擅长构建有节奏感、情节递进清晰的故事大纲。'),
      this.userMessage(context),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const jsonMatch = trimmed.match(/\[[\s\S]*?\]/) || trimmed.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) {
      return { success: false, error: '无法解析大纲数据：未找到 JSON 格式' }
    }
    try {
      const data = JSON.parse(jsonMatch[0])
      return { success: true, data }
    } catch {
      return { success: false, error: '无法解析大纲数据：JSON 格式错误' }
    }
  }

  processOutput(output: AgentOutput): ChapterOutline[] {
    if (!output.success || !Array.isArray(output.data)) return []
    return (output.data as Array<{
      number?: number
      title?: string
      description?: string
      summary?: string
      coreEvent?: string
    }>).map((item, idx) => ({
      id: generateId(),
      number: item.number ?? idx + 1,
      title: item.title ?? `第${idx + 1}章`,
      description: item.description ?? item.summary ?? item.coreEvent ?? '',
    }))
  }
}