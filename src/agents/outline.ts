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

重要提醒：
1. 必须严格生成 exactly ${state.totalChapters} 个章节，不能多也不能少
2. 必须以 JSON 数组格式输出，每个章节是独立对象，包含 number、title、description 字段`

    return [
      this.systemMessage('你是一位擅长故事结构的大纲设计师，擅长构建有节奏感、情节递进清晰的故事大纲。\n\n重要：请务必以 JSON 数组格式输出大纲，每个章节必须是独立的对象，包含以下字段：\n- number：章节编号（数字）\n- title：章节标题（字符串）\n- description：本章核心事件描述（字符串）\n\n示例格式：\n[{"number": 1, "title": "第一章标题", "description": "核心事件..."}, ...]'),
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

  async regenerateChapter(state: AgentState, chapterIndex: number): Promise<ChapterOutline | null> {
    const displayNum = chapterIndex + 1

    const otherOutlines = state.outline
      ? state.outline.split('\n\n').filter((_, i) => i !== chapterIndex).join('\n\n')
      : ''

    const context = `
书名：${state.title || '（无标题）'}
故事简介：${state.idea}

${state.world ? `世界观设定：\n${state.world}` : ''}

人物设定：
${state.characters || '（尚未创建）'}

其他章节大纲：
${otherOutlines || '（无其他章节）'}

请仅为第 ${displayNum} 章重新生成大纲，要求：
1. 保持与前后章节的逻辑连贯
2. 符合故事整体风格和节奏
3. 输出格式：JSON对象，包含 number、title、description 字段
4. 只输出第 ${displayNum} 章的大纲，不要输出其他章节`

    const messages = [
      this.systemMessage('你是一位擅长故事结构的大纲设计师，擅长构建有节奏感、情节递进清晰的故事大纲。\n\n重要：只需输出单个章节的大纲，以 JSON 格式返回，包含字段：\n- number：章节编号（数字）\n- title：章节标题（字符串）\n- description：本章核心事件描述（字符串）\n\n示例：{"number": 1, "title": "觉醒", "description": "少年在山谷中偶遇..."}'),
      this.userMessage(context),
    ]

    try {
      const content = await this.chat(messages)
      const output = this.parse(content)
      const outlines = this.processOutput(output)
      return outlines.find(o => o.number === displayNum) || outlines[0] || null
    } catch (err) {
      return null
    }
  }
}