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

    const characterOmissionIssues = state.issues?.filter(i =>
      i.type === 'consistency' &&
      (i.description.includes('角色遗漏') || i.description.includes('未提及') || i.description.includes('未出现'))
    ) ?? []

    const issuesSection = state.issues && state.issues.length > 0
      ? `【上轮问题反馈 - 必须在本次规划中修复】
${state.issues.map((issue, i) => `${i + 1}. [${issue.type}] ${issue.description}${issue.location ? `\n   位置: ${issue.location}` : ''}${issue.suggestion ? `\n   建议: ${issue.suggestion}` : ''}`).join('\n')}

【要求】请逐条对照上述问题，在本次规划中确保：
- 每个遗漏的大纲情节点都在 sections 中明确体现
- 每个错误的时间线都在 timeline 中纠正
- 每个未落实的要求都在 outlineCheck 中标记为 fulfilled
- 不得为了修补前文矛盾而发明新事实、新来源、新因果或新设定；只能使用大纲、世界观、人物设定和前文摘要中已经提供的信息
- 不得让角色说出其未在前文获得的信息；如果某个矛盾无法在已知信息内自然解决，应在规划中回避该解释或保持待解，而不是强行解释
${characterOmissionIssues.length > 0 ? `
【角色遗漏专项修复】
上轮检测到以下角色遗漏问题，本次规划必须修复：
${characterOmissionIssues.map((issue, i) => `${i + 1}. ${issue.description}`).join('\n')}
修复方式（二选一）：
- 方式A：在相关段落的 characters 列表中加入该角色，并在 events 中设计该角色的出场情节
- 方式B：在 timeline 或某段落的 events 中明确说明该角色缺席的合理原因（如"留守庄院"、"外出化缘"、"因伤休养"等）
禁止方式：不得无视该角色，不得让其无故消失且不作任何交代。` : ''}`
      : ''

    const userContent = `<task>请为第 ${displayChapterNumber} 章生成详细的写作规划。</task>

<context>
<outline>
【必须严格遵循】本章大纲：
${outline}
</outline>

${issuesSection}

<world>
【必须严格遵循】世界观设定：
${state.world || '（尚未构建）'}
</world>

<characters>
【必须严格遵循】人物设定：
${state.characters || '（尚未创建）'}
</characters>

<previous_summary>
前几章摘要：
${previousSummary}
</previous_summary>
</context>

<instruction>
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
5. 【角色完整性检查 - 必须执行】
   - 扫描人物设定和前几章摘要，识别哪些角色已加入团队/组织或已成为常驻角色
   - 对于每个已加入的常驻角色，必须在本章规划中明确安排：
     a) 出场：在对应段落的 characters 列表中加入该角色
     b) 缺席：在 timeline 或 events 中明确说明缺席原因（如"留守"、"外出"、"养伤"等）
   - 禁止无故遗漏任何已加入的团队成员
   - 如果问题反馈指出角色遗漏，必须按【角色遗漏专项修复】要求处理

6. 【重要】检查前面章节中是否有遗留的未解决状态：
   - 扫描前面章节摘要，识别哪些角色处于特殊状态（如失去自由、记忆缺失、下落不明、身体受损等）
   - 如果本章大纲涉及这些状态的改变，请确保在规划中包含"衔接段落"
   - 衔接段落位置：放在本章最前面或相关情节之前
   - 衔接段落内容：通过角色对话、简短回忆或旁白，解释关键状态的变化过程
   - 衔接段落只能承接已知事实，不得为了修补前文矛盾而发明新事实、新来源、新因果或新设定
   - 不得让角色说出其未在前文获得的信息；如果当前资料不足以解释，只能保持模糊或待解
   - 示例：某角色长期处于某种特殊状态后在本章出现 → 增加一段回忆说明状态变化过程
</instruction>

<output_format>
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
</output_format>

<important>
【重要】
- 如果大纲要求"高烧持续三日后才退"，时间线必须显示三日，不能只写"过了一夜"
- 如果大纲要求某人说特定台词，规划中必须标注该台词原样出现
- 如果大纲要求"次日"发生某事，时间线必须显示"第一日→第二日"的过渡
- 所有大纲情节点必须在 outlineCheck 中标记为 fulfilled: true
- 所有已加入的常驻角色必须在 sections 或 timeline 中有明确交代，不得无故遗漏
</important>`

    return [
      this.systemMessage('你是一位严谨的小说结构规划师。你的任务是在写作前生成详细的章节规划，确保每个大纲要求都被精确落实。你对时间线和情节顺序的准确性有零容忍态度。'),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()

    const extractors = [
      () => {
        const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
        return match ? match[1]!.trim() : null
      },
      () => {
        const match = trimmed.match(/\{[\s\S]*?\}(?=\s*$)/)
        return match ? match[0] : null
      },
      () => {
        const start = trimmed.indexOf('{')
        const end = trimmed.lastIndexOf('}')
        if (start !== -1 && end !== -1 && end > start) {
          return trimmed.slice(start, end + 1)
        }
        return null
      },
    ]

    let jsonText: string | null = null
    for (const extractor of extractors) {
      jsonText = extractor()
      if (jsonText) break
    }

    if (!jsonText) {
      return { success: false, error: '无法解析规划数据：未找到 JSON 格式' }
    }

    const repaired = this.repairJson(jsonText)

    try {
      const data = JSON.parse(repaired) as ChapterPlan
      if (!data.sections || !Array.isArray(data.sections)) {
        return { success: false, error: '规划数据缺少 sections 字段' }
      }
      if (!data.timeline || !Array.isArray(data.timeline)) {
        return { success: false, error: '规划数据缺少 timeline 字段' }
      }
      if (!data.outlineCheck || !Array.isArray(data.outlineCheck)) {
        data.outlineCheck = []
      }
      const unfulfilled = data.outlineCheck.filter(c => !c.fulfilled)
      if (unfulfilled.length > 0) {
        console.warn(`[MuseFlow] 规划警告：${unfulfilled.length} 项大纲要求未在规划中明确落实`)
        for (const u of unfulfilled) {
          console.warn(`  - ${u.requirement}`)
        }
      }
      return { success: true, data }
    } catch (err) {
      console.error('[MuseFlow] DEBUG: JSON parse failed')
      const match = err instanceof Error ? err.message.match(/position (\d+)/) : null
      const errorPos = match && match[1] ? parseInt(match[1]) : null
      if (errorPos && errorPos > 0) {
        const start = Math.max(0, errorPos - 200)
        const end = Math.min(repaired.length, errorPos + 200)
        console.error(`[MuseFlow] DEBUG: Problem area around position ${errorPos}:`)
        console.error(repaired.substring(start, end))
      }
      console.error('[MuseFlow] DEBUG: Parse error:', err instanceof Error ? err.message : String(err))
      return { success: false, error: '无法解析规划数据：JSON 格式错误' }
    }
  }

  private repairJson(text: string): string {
    let repaired = text
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([\{,])\s*([a-zA-Z_\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]*)\s*:/g, '$1"$2":')

    // 修复单引号包裹的字符串（转为双引号）
    repaired = repaired.replace(/'([^'\n]*?)'/g, '"$1"')

    // 移除 JSON 中的注释（// 和 /* */）
    repaired = repaired.replace(/\/\/.*$/gm, '')
    repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '')

    // 修复缺失的逗号：在对象/数组元素之间添加逗号
    repaired = repaired.replace(/}(\s*){/g, '},$1{')
    repaired = repaired.replace(/](\s*)\[/g, '],$1[')
    repaired = repaired.replace(/"(\s*){/g, '",$1{')
    repaired = repaired.replace(/}(\s*)"/g, '},$1"')

    // 修复 undefined 值
    repaired = repaired.replace(/: undefined/g, ': null')
    repaired = repaired.replace(/: undefined,/g, ': null,')

    // 修复 JSON 字符串值内部未转义的双引号
    repaired = this.escapeInnerQuotes(repaired)

    return repaired
  }

  private escapeInnerQuotes(json: string): string {
    let result = ''
    let inString = false
    let escaped = false
    let stringStart = -1

    for (let i = 0; i < json.length; i++) {
      const char = json[i]

      if (inString) {
        if (escaped) {
          escaped = false
          result += char
        } else if (char === '\\') {
          escaped = true
          result += char
        } else if (char === '"') {
          // 检查这是否是字符串的结束引号
          // 如果下一个非空白字符是 : , } ] 之一，则这是结束引号
          let j = i + 1
          while (j < json.length && /\s/.test(json[j]!)) j++
          const nextChar = json[j]
          if (nextChar === undefined || nextChar === ':' || nextChar === ',' || nextChar === '}' || nextChar === ']') {
            inString = false
            result += char
          } else {
            // 这是字符串内部的未转义引号，需要转义
            result += '\\"'
          }
        } else {
          result += char
        }
      } else {
        if (char === '"') {
          inString = true
          stringStart = i
          result += char
        } else {
          result += char
        }
      }
    }

    return result
  }
}
