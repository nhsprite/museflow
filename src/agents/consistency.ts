import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Issue } from '../types/agent.js'
import { generateId } from '../utils/id.js'

export class ConsistencyAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)
  }
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const userContent = `请检测以下章节内容的逻辑一致性问题。

【重要】你只应检测"待检测章节"本身引入的新问题，或者是该章节中可以直接修正的问题。
如果某个一致性问题根源于前几章（需要修改前几章才能修复），请不要报告它——这超出了当前修复范围。

前几章摘要（仅作参考，用于理解上下文）：
${state.chapterSummaries?.length ? state.chapterSummaries.map((s, i) => `第${i + 1}章摘要：${s}`).join('\n\n') : '（这是第一章）'}

待检测章节：
${state.chapterContent || '（无内容）'}

一致性检测维度（仅针对待检测章节）：
1. **时间逻辑**：本章内事件发生的时间顺序是否合理
2. **空间逻辑**：本章内人物移动、位置变化是否连贯
3. **因果逻辑**：本章内事件之间的因果关系是否合理
4. **信息一致**：本章人物对信息的了解是否与前文冲突（且可在本章内修正）
5. **伏笔回收**：本章是否回收了之前埋下的伏笔
6. **节奏一致**：本章节奏是否与整体故事节奏一致

请输出 JSON 格式的检测结果：
{
  "is_consistent": true或false,
  "issues": [
    {
      "type": "consistency",
      "severity": "error|warning|info",
      "description": "问题描述",
      "aspect": "time|space|causality|information|pace",
      "location": "具体位置"
    }
  ]
}

如果没有任何逻辑问题，请返回 {"is_consistent": true, "issues": []}。`

    return [
      this.systemMessage('你是一位逻辑严谨的编辑，擅长发现故事中的逻辑漏洞和前后矛盾。'),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { success: false, error: '无法解析检测数据：未找到 JSON 格式' }
    }
    try {
      const data = JSON.parse(jsonMatch[0])
      return { success: true, data }
    } catch {
      return { success: false, error: '无法解析检测数据：JSON 格式错误' }
    }
  }

  processOutput(output: AgentOutput): Issue[] {
    if (!output.success || !output.data) return []
    const data = output.data as {
      is_consistent?: boolean
      issues?: Array<{
        type?: string
        severity?: string
        description?: string
        aspect?: string
        location?: string
      }>
    }

    if (data.is_consistent === true && (!data.issues || data.issues.length === 0)) {
      return []
    }

    return (data.issues || []).map(issue => {
      const result: Issue = {
        id: generateId(),
        type: 'consistency',
        severity: (issue.severity as IssueSeverity) || 'warning',
        description: issue.description || '',
      }
      if (issue.location) {
        result.location = issue.location
      }
      return result
    })
  }
}

type IssueSeverity = 'error' | 'warning' | 'info'