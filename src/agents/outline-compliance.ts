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

    const userContent = `请检查以下章节是否严格遵循了大纲要求。

章节大纲：
${outlineItem}

章节正文：
${state.chapterContent || '（无内容）'}

请进行以下检查：

1. **核心事件检查**：章节是否完成了大纲中规定的核心事件？
2. **情节偏离检查**：是否有大纲之外的额外情节？这些情节是否必要？
3. **章节标题检查**：章节内容是否符合标题的预期？
4. **逻辑连贯性**：章节内部逻辑是否连贯？

请输出 JSON 格式的检查结果：
{
  "is_compliant": true或false，表示是否严格遵循大纲,
  "deviations": [
    {
      "type": "missing_event|extra_event|title_mismatch|logic_issue",
      "severity": "error|warning|info",
      "description": "偏离描述",
      "suggestion": "改进建议"
    }
  ],
  "summary": "总体评估"
}`

    return [
      this.systemMessage(`你是一位严谨的故事结构审核员，负责确保每个章节都严格遵循既定的大纲。你对偏离大纲的行为保持零容忍态度。`),
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
      deviations?: Array<{
        type?: string
        severity?: string
        description?: string
        suggestion?: string
      }>
      summary?: string
    }

    const issues: Issue[] = (data.deviations || []).map(dev => {
      const issueType = dev.type === 'missing_event' ? 'outline_violation' : 'outline_deviation'
      return {
        id: generateId(),
        type: issueType,
        severity: (dev.severity as Issue['severity']) || 'warning',
        description: `[大纲偏离] ${dev.description || ''}${dev.suggestion ? `\n建议：${dev.suggestion}` : ''}`,
      }
    })

    return {
      issues,
      isCompliant: data.is_compliant ?? true,
    }
  }
}
