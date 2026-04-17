import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Issue } from '../types/agent.js'
import { generateId } from '../utils/id.js'

export class HallucinationAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)
  }
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const userContent = `请检测以下章节内容是否存在与已建立的世界观或人物设定不一致的"幻觉"内容。

世界观设定：
${state.world || '（尚未构建）'}

人物设定：
${state.characters || '（尚未创建）'}

待检测章节内容：
${state.chapterContent || '（无内容）'}

幻觉检测维度：
1. **世界规则冲突**：描述与已建立的世界规则（如魔法体系、科技水平、地理设定）相悖的内容
2. **人物性格冲突**：人物言行与其已建立的性格特点不符
3. **事实矛盾**：与前文已确立的事实相矛盾
4. **不可能发生**：基于已建立规则，某些事件不可能发生
5. **未介绍元素**：使用到前文未介绍的人物、地点或物品

请输出 JSON 格式的检测结果：
{
  "is_consistent": true或false,
  "issues": [
    {
      "type": "hallucination",
      "severity": "error|warning|info",
      "description": "问题描述",
      "conflict_with": "与什么设定冲突",
      "location": "具体位置"
    }
  ]
}

如果没有任何冲突，请返回 {"is_consistent": true, "issues": []}。`

    return [
      this.systemMessage('你是一位严谨的世界观守护者，擅长发现叙述中与已建立设定不相符的"幻觉"内容。'),
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
        conflict_with?: string
        location?: string
      }>
    }

    if (data.is_consistent === true && (!data.issues || data.issues.length === 0)) {
      return []
    }

    return (data.issues || []).map(issue => {
      const result: Issue = {
        id: generateId(),
        type: 'hallucination',
        severity: (issue.severity as IssueSeverity) || 'warning',
        description: issue.description || '',
      }
      const loc = issue.location || issue.conflict_with
      if (loc) {
        result.location = loc
      }
      return result
    })
  }
}

type IssueSeverity = 'error' | 'warning' | 'info'