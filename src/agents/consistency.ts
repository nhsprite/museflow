import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Issue } from '../types/agent.js'
import { generateId } from '../utils/id.js'
import { buildLayeredSummaries } from '../utils/summary-compressor.js'

export class ConsistencyAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)
  }
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const userContent = `请检测以下章节内容的逻辑一致性问题。

【检测范围 - 重要】
你需要检测两类问题：
1. 当前章节内部的逻辑矛盾（时间、空间、因果）
2. **当前章节与前面章节之间的逻辑矛盾**（角色知识、对话内容、事件描述、信息传递）

对于跨章节矛盾：如果当前章节的写法与前面章节已经确立的事实冲突，即使"问题看起来根源于前面章节"，也必须报告。这类跨章节角色知识矛盾是严重的叙事漏洞，必须被发现。

【世界观设定】
${state.world || '（暂无世界观设定）'}

【人物设定】
${state.characters || '（暂无人物设定）'}

【大纲】
${state.outline || '（暂无大纲）'}

【前面章节已确立的关键事实】
${state.timelineSnapshot || '（暂无历史记录）'}

【前几章摘要】
${buildLayeredSummaries(state.chapterSummaries ?? [], state.chapterIndex ?? 0)}

【待检测章节】
${state.chapterContent || '（无内容）'}

一致性检测维度：
1. **时间逻辑**：事件时间顺序是否合理，是否存在"同一天写了三天后的事"等矛盾
2. **空间逻辑**：人物移动、位置变化是否连贯
3. **因果逻辑**：事件因果关系是否合理
4. **角色知识一致性（重点）**：角色对某信息的了解/态度是否与前章矛盾
   - 检查每个角色在前章中已知/承认/说过的事实
   - 对比该角色在本章中对这些事实的态度/反应
   - 标记"前一章亲口承认X，本章却表现得像第一次听说X"这类严重矛盾
   - 注意：如果角色故意装作不知道，必须有合理的动机铺垫（如欺骗、试探），否则视为矛盾
5. **对话一致性（重点）**：角色说过的话是否前后矛盾
   - 前一章角色亲口说的内容，本章不能自相矛盾
   - 例如：前一章说"信是我转交的"，本章不能说"什么信？"
6. **信息一致**：关键信息（物品、消息、秘密）的传递和知悉情况是否前后一致
7. **伏笔回收**：本章是否回收了之前埋下的伏笔
8. **节奏一致**：本章节奏是否与整体故事节奏一致

【分级标准 - 严格按此执行】
- **error**：以下严重逻辑矛盾：
  - 跨章节的角色知识/对话矛盾（如角色态度突变无解释、亲口说过的话前后矛盾）
  - 时间线严重矛盾（如先写"三天后"后面又写"同一天"）
  - 关键信息前后矛盾（如先写"纸条已被取走"后面又写"发现纸条"）
  - 因果关系完全断裂（如毫无铺垫地发生关键事件）
- **warning**：一般性不一致：
  - 细节描述有轻微出入（如某个物品的描述前后略有不同但不影响理解）
  - 时间标记不够明确（如"不知过了多久"但没有明确的时间跳跃）
  - 表述歧义（如某个描述可以有多种理解但不构成矛盾）
- **info**：建议性意见：
  - 可以加强因果关联
  - 可以补充过渡段落

【重要】请严格控制 error 数量，只有真正让读者困惑的逻辑矛盾才报 error。一般性不一致报 warning，建议性意见报 info。

请输出 JSON 格式的检测结果：
{
  "is_consistent": true或false,
  "issues": [
    {
      "type": "consistency",
      "severity": "error|warning|info",
      "description": "问题描述（请明确指出涉及哪些章节的哪些内容）",
      "aspect": "time|space|causality|character_knowledge|dialogue|information|foreshadowing|pace",
      "location": "具体位置"
    }
  ]
}

如果没有任何逻辑问题，请返回 {"is_consistent": true, "issues": []}。`

    return [
      this.systemMessage('你是一位逻辑严谨的编辑，擅长发现故事中的逻辑漏洞，尤其擅长发现跨章节的角色知识和对话矛盾。你的评审标准是：只有真正让读者困惑的逻辑矛盾才报 error，一般性不一致报 warning，建议性意见报 info。请严格控制 error 数量。'),
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
