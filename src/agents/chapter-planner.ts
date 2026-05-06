import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'

export interface ChapterPlan {
  sections: Array<{
    title: string
    summary: string
    wordCount: number
    events: string[]
    characters: string[]
    timeMark?: string
  }>
  timeline: Array<{
    event: string
    time: string
    notes: string
  }>
  outlineCheck: Array<{
    requirement: string
    fulfilled: boolean
    section: string
  }>
}

export class ChapterPlannerAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)
  }

  protected buildPrompt(state: Required<AgentState>): import('../model/provider.js').Message[] {
    const chapterIndex = state.chapterIndex ?? 0
    const displayChapterNumber = toDisplayChapterNumber(chapterIndex)
    const outline = state.outline || ''

    const previousSummary = state.previousChapters || '（这是第一章）'

    const userContent = `请为第 ${displayChapterNumber} 章生成详细的写作规划。

【必须严格遵循】本章大纲：
${outline}

【必须严格遵循】世界观设定：
${state.world || '（尚未构建）'}

【必须严格遵循】人物设定：
${state.characters || '（尚未创建）'}

前几章摘要：
${previousSummary}

【规划要求】
1. 将本章拆分为 3-6 个段落/场景
2. 对每个段落，明确：
   - 段落标题（简短）
   - 内容摘要（1-2句话）
   - 预计字数
   - 涉及的事件（必须对应大纲中的情节点）
   - 出场人物
   - 时间标记（如"当天夜晚""三日后""凌晨寅时"等，必须明确）
3. 列出完整的时间线，确保：
   - 时间顺序正确，不能出现时间回退或跳跃未交代的情况
   - 每个关键事件都有明确的时间标记
   - 时间间隔符合大纲要求（如"高烧持续三日"必须真的跨越三日）
4. 逐条检查大纲要求，确保：
   - 大纲中的每个情节点都出现在规划中
   - 大纲中提到的所有事件都有对应的段落
   - 大纲中提到的关键台词必须原样保留
   - 大纲中的时间要求（如"三日后""次日"）必须在时间线中体现
5. 【重要】检查前面章节中是否有遗留的未解决状态：
   - 扫描前面章节摘要，识别哪些角色处于特殊状态（被囚禁、失忆、失踪、受伤等）
   - 如果本章大纲涉及这些状态的改变，请确保在规划中包含"衔接段落"
   - 衔接段落位置：放在本章最前面或相关情节之前
   - 衔接段落内容：通过角色对话、简短回忆或旁白，解释关键状态的变化过程
   - 示例：某角色被囚禁多章后在本章出现 → 增加一段回忆说明营救过程

【输出格式】
请输出 JSON 格式：
{
  "sections": [
    {
      "title": "段落标题",
      "summary": "内容摘要",
      "wordCount": 预计字数,
      "events": ["涉及事件1", "涉及事件2"],
      "characters": ["人物1", "人物2"],
      "timeMark": "时间标记"
    }
  ],
  "timeline": [
    {
      "event": "事件描述",
      "time": "具体时间",
      "notes": "注意事项"
    }
  ],
  "outlineCheck": [
    {
      "requirement": "大纲要求的具体内容",
      "fulfilled": true或false,
      "section": "对应段落标题"
    }
  ]
}

【重要】
- 如果大纲要求"高烧持续三日后才退"，时间线必须显示三日，不能只写"过了一夜"
- 如果大纲要求某人说特定台词，规划中必须标注该台词原样出现
- 如果大纲要求"次日"发生某事，时间线必须显示"第一日→第二日"的过渡
- 所有大纲情节点必须在 outlineCheck 中标记为 fulfilled: true`

    return [
      this.systemMessage('你是一位严谨的小说结构规划师。你的任务是在写作前生成详细的章节规划，确保每个大纲要求都被精确落实。你对时间线和情节顺序的准确性有零容忍态度。'),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { success: false, error: '无法解析规划数据：未找到 JSON 格式' }
    }
    try {
      const data = JSON.parse(jsonMatch[0]) as ChapterPlan
      if (!data.sections || !Array.isArray(data.sections)) {
        return { success: false, error: '规划数据缺少 sections 字段' }
      }
      if (!data.timeline || !Array.isArray(data.timeline)) {
        return { success: false, error: '规划数据缺少 timeline 字段' }
      }
      if (!data.outlineCheck || !Array.isArray(data.outlineCheck)) {
        return { success: false, error: '规划数据缺少 outlineCheck 字段' }
      }
      const unfulfilled = data.outlineCheck.filter(c => !c.fulfilled)
      if (unfulfilled.length > 0) {
        return {
          success: false,
          error: `大纲检查未通过，以下要求未落实：${unfulfilled.map(u => u.requirement).join('、')}`,
        }
      }
      return { success: true, data }
    } catch {
      return { success: false, error: '无法解析规划数据：JSON 格式错误' }
    }
  }
}
