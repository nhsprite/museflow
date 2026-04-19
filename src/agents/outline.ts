import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { ChapterOutline } from '../graph/state.js'
import { generateId } from '../utils/id.js'

export class OutlineAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.5)
  }
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const genre = this.getGenre(state.genre)

    const titleLine = state.title ? `书名：${state.title}` : ''
    const wd = state.worldDirection
    const worldDirSection = wd
      ? `世界观方向：
${wd.cultivationSystem ? `- 修炼体系：${wd.cultivationSystem}` : ''}
- 核心冲突：${wd.coreConflict}
- 世界观特色：${wd.worldFeatures.join('、')}`
      : ''

    const outlineTemplate = genre?.outlineTemplate ??
      `根据以下信息，为一部 {totalChapters} 章的小说制定大纲。
${titleLine}
故事简介：{idea}
${worldDirSection ? '\n' + worldDirSection : ''}

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
${state.world ? `世界观设定：\n${state.world}` : ''}

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

    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (codeBlockMatch) {
      try {
        const data = JSON.parse(codeBlockMatch[1]!.trim())
        return { success: true, data }
      } catch {
      }
    }

    const jsonMatch = trimmed.match(/\[[\s\S]*?\]/) || trimmed.match(/\{[\s\S]*?\}/)
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[0])
        return { success: true, data }
      } catch {
      }
    }

    const chapterBlockRegex = /#{1,3}\s*第([一二三四五六七八九十百\d]+)章[··：:]\s*([^\n]+)\n([\s\S]*?)(?=\n---|\n#{1,3}\s*第|$)/g
    const matches = [...trimmed.matchAll(chapterBlockRegex)]
    if (matches.length > 0) {
      const chapters = matches.map((match, idx) => {
        const numStr = match[1]!
        const title = match[2]!.trim()
        const description = match[3]!.replace(/\n---/g, '').trim()
        const chineseToNum: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 }
        const num = chineseToNum[numStr] || parseInt(numStr, 10) || idx + 1
        return { number: num, title, description }
      })
      if (chapters.length > 0) {
        return { success: true, data: chapters }
      }
    }

    return { success: false, error: '无法解析大纲数据：未找到 JSON 格式' }
  }

  processOutput(output: AgentOutput): ChapterOutline[] {
    if (!output.success) {
      return []
    }
    if (!Array.isArray(output.data)) {
      if (output.data && typeof output.data === 'object') {
        const obj = output.data as Record<string, unknown>
        let chapters: unknown[] = []
        if (Array.isArray(obj.outline)) {
          chapters = obj.outline
        } else {
          for (const val of Object.values(obj)) {
            if (Array.isArray(val)) {
              chapters = val
              break
            }
          }
        }
        if (chapters.length > 0) {
          return chapters.map((item: unknown, idx: number) => {
            const c = item as Record<string, unknown>
            return {
              id: generateId(),
              number: Number(c['number'] || c['章节编号'] || c['章号'] || idx + 1),
              title: String(c['title'] || c['章节标题'] || c['标题'] || `第${idx + 1}章`),
              description: String(c['description'] || c['章节描述'] || c['描述'] || c['summary'] || c['coreEvent'] || c['核心事件'] || ''),
            }
          })
        }
      }
      return []
    }
    return output.data.map((item: unknown, idx: number) => {
      const c = item as Record<string, unknown>
      return {
        id: generateId(),
        number: Number(c['number'] || c['章节编号'] || c['章号'] || idx + 1),
        title: String(c['title'] || c['章节标题'] || c['标题'] || `第${idx + 1}章`),
        description: String(c['description'] || c['章节描述'] || c['描述'] || c['summary'] || c['coreEvent'] || c['核心事件'] || ''),
      }
    })
  }
}