import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Issue } from '../types/agent.js'
import { generateId } from '../utils/id.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'

export class OutlineComplianceAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)
  }

  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const chapterIndex = state.chapterIndex ?? 0
    const displayNum = toDisplayChapterNumber(chapterIndex)

    const outlineItem = state.outline || ''

    const userContent = `<instruction>
  请检查以下章节是否严格遵循了大纲要求。
  你是一位极其严格的故事结构审核员，负责确保每个章节都严格遵循既定的大纲。你对偏离大纲的行为保持零容忍态度。你必须逐条检查大纲中的每个情节点，绝不能遗漏任何要求。
</instruction>

<context>
  <outline>
    ${outlineItem}
  </outline>
  <chapter_content>
    ${state.chapterContent || '（无内容）'}
  </chapter_content>
</context>

<checklist>
  <check_item id="1" name="核心事件逐条检查">
    <step>将大纲描述拆分为独立的情节点（以句号、分号或"并且"/"同时"/"然后"等连接词为界）</step>
    <step>对每个情节点，检查正文中是否有对应的内容</step>
    <step>如果大纲提到多个事件（如"A发生，并且B发生"），必须检查A和B是否都出现</step>
  </check_item>

  <check_item id="2" name="时间线检查">
    <step>大纲中明确的时间要求（如"三日后""次日""凌晨"）是否在正文中精确体现</step>
    <step>正文的时间跨度是否与大纲一致（不能只写"过了一夜"代替"过了三日"）</step>
    <step>事件顺序是否与大纲一致</step>
  </check_item>

  <check_item id="3" name="关键台词检查">
    <step>大纲中提到的具体台词是否在正文中原样出现</step>
    <step>台词的说话人是否正确</step>
    <step>不能将大纲要求的特定台词改写为意思相近但措辞不同的句子</step>
  </check_item>

  <check_item id="4" name="情节偏离检查">
    <step>是否有大纲之外的额外情节？</step>
    <step>额外情节是否冲淡核心事件的叙事重心？</step>
    <step>是否遗漏了大纲要求的关键事件？</step>
  </check_item>

  <check_item id="5" name="人物行为检查">
    <step>人物出场顺序是否与大纲一致</step>
    <step>人物行为是否符合大纲描述</step>
    <step>是否有大纲未提及的人物出现并占据过多篇幅？</step>
  </check_item>

  <check_item id="6" name="逻辑连贯性">
    <step>章节内部时间线是否连贯</step>
    <step>因果关系是否合理</step>
    <step>是否有前后矛盾（如先写病好了，后面又写还在生病）</step>
  </check_item>
</checklist>

<output_format>
  请输出 JSON 格式的检查结果：
  {
    "is_compliant": true或false,
    "event_checks": [
      {
        "event": "大纲中的具体情节点",
        "found": true或false,
        "location": "在正文中的位置"
      }
    ],
    "deviations": [
      {
        "type": "missing_event|extra_event|timeline_mismatch|dialogue_mismatch|title_mismatch|logic_issue|character_order",
        "severity": "error|warning|info",
        "description": "偏离描述",
        "suggestion": "改进建议"
      }
    ],
    "summary": "总体评估"
  }
</output_format>`

    return [
      this.systemMessage(`你是一位极其严格的故事结构审核员，负责确保每个章节都严格遵循既定的大纲。你对偏离大纲的行为保持零容忍态度。你必须逐条检查大纲中的每个情节点，绝不能遗漏任何要求。`),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { success: false, error: '无法解析检查数据：未找到 JSON 格式' }
    }
    try {
      const data = JSON.parse(jsonMatch[0])
      return { success: true, data }
    } catch {
      return { success: false, error: '无法解析检查数据：JSON 格式错误' }
    }
  }

  processOutput(output: AgentOutput): { issues: Issue[]; isCompliant: boolean } {
    if (!output.success || !output.data) {
      return { issues: [], isCompliant: true }
    }

    const data = output.data as {
      is_compliant?: boolean
      event_checks?: Array<{
        event?: string
        found?: boolean
        location?: string
      }>
      deviations?: Array<{
        type?: string
        severity?: string
        description?: string
        suggestion?: string
      }>
      summary?: string
    }

    const issues: Issue[] = []

    if (data.event_checks) {
      const missingEvents = data.event_checks.filter(e => !e.found)
      for (const event of missingEvents) {
        issues.push({
          id: generateId(),
          type: 'outline_violation',
          severity: 'error',
          description: `[大纲偏离] 缺少大纲要求的情节点：${event.event || '未知事件'}`,
        })
      }
    }

    for (const dev of (data.deviations || [])) {
      const issueType = dev.type === 'missing_event' ? 'outline_violation' : 'outline_deviation'
      const issue: Issue = {
        id: generateId(),
        type: issueType,
        severity: (dev.severity as Issue['severity']) || 'warning',
        description: `[大纲偏离] ${dev.description || ''}`,
      }
      if (dev.suggestion) {
        issue.suggestion = dev.suggestion
      }
      issues.push(issue)
    }

    return {
      issues,
      isCompliant: data.is_compliant ?? true,
    }
  }
}
