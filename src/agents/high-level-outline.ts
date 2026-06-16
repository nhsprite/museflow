import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { ChapterOutline } from '../graph/state.js'
import { generateId } from '../utils/id.js'

export interface HighLevelOutlineData {
  chapters: ChapterOutline[]
}

export class HighLevelOutlineAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.5)
  }

  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const userContent = `请为一部 ${state.totalChapters} 章的长篇小说生成高层次的章节大纲。

<idea>
${state.idea}
</idea>

<genre>
${state.genre || 'default'}
</genre>

${state.title ? `<title>\n书名：${state.title}\n</title>` : ''}

${state.worldDirection ? `<world_direction>\n${state.worldDirection.coreConflict}\n${state.worldDirection.worldFeatures?.join('、') || ''}\n</world_direction>` : ''}

${state.world ? `<world_setting>\n${state.world}\n</world_setting>` : ''}

${state.characters ? `<characters>\n${state.characters}\n</characters>` : ''}

<requirements>
- 每章只写 1–2 句话，控制在 30–60 字
- 只描述核心转折或关键事件，不写具体细节、对话或场景执行
- 不要把后续章节的事件提前解决；如果某章暂时制服敌人，请明确为"暂时""待后续处置"
- 相邻章节之间不应重复处理同一核心事件
- 输出 JSON 格式：
  {
    "chapters": [
      { "number": 1, "title": "章节标题", "description": "章节弧线描述" }
    ]
  }
</requirements>`

    return [
      this.systemMessage('你是一位擅长故事结构的小说策划。你的任务是为长篇小说生成高层次的章节弧线，每章只写核心转折，不写细节。'),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { success: false, error: '无法解析大纲：未找到 JSON 格式' }
    }
    try {
      const data = JSON.parse(jsonMatch[0]) as HighLevelOutlineData
      if (!Array.isArray(data.chapters)) {
        return { success: false, error: '大纲格式错误：chapters 不是数组' }
      }
      const chapters = data.chapters.map(ch => ({
        id: generateId(),
        number: ch.number,
        title: ch.title,
        description: ch.description,
      }))
      return { success: true, data: { chapters } }
    } catch {
      return { success: false, error: '无法解析大纲：JSON 格式错误' }
    }
  }
}
