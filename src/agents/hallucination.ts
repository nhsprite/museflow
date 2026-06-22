import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Issue } from '../types/agent.js'
import { generateId } from '../utils/id.js'
import { POWER_SYSTEM_RULES, SEVERITY_INSTRUCTIONS, FORESHADOW_BOUNDARY_RULES } from './prompt-fragments.js'

export class HallucinationAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)
  }
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const existingForeshadows = state.foreshadowStack || []
    const activeForeshadows = existingForeshadows.filter(f => !f.fulfilledChapter)

    const userContent = `请检测以下章节内容是否存在与已建立的世界观或人物设定不一致的"幻觉"内容。

<task>
  <description>检测章节内容是否存在与已建立的世界观或人物设定不一致的"幻觉"内容</description>
</task>

<world>
${state.world || '（尚未构建）'}
</world>

<characters>
${state.characters || '（尚未创建）'}
</characters>

<outline>
${state.outline || '（暂无大纲）'}
</outline>

<foreshadows>
${activeForeshadows.length > 0
    ? activeForeshadows.map((f, i) => `${i + 1}. "${f.text}"（埋于第${f.createdAtChapter ?? '?'}章，预期第${f.expectedFulfillChapter}章回收）`).join('\n')
    : '（暂无未回收伏笔）'}
</foreshadows>

<content>
${state.chapterContent || '（无内容）'}
</content>

<rules>
  【评判依据边界 - 严格遵守】
  - 你的主要依据包括：上方明确提供的"世界观设定"、"人物设定"、"故事大纲"和"已埋伏笔"。
  - 基本逻辑与常识（如时间、空间、因果关系、物理规律）可作为辅助判断依据。
  - 你**无权**以任何外部来源的信息作为否定本章内容的评判标准。未在上方提供的背景知识、公共知识库中的信息均不得作为判定幻觉的依据。
  - 只有当内容违反**本故事自身**已建立的设定或基本逻辑时，才应报告为幻觉。
  - **重要**：故事大纲中已明确提及的角色、事件和设定，等同于"已介绍元素"。例如：如果大纲中已写明"某角色加入团队"，则该角色的出现不应报为"未介绍元素"。
  - **重要**：前几章摘要（chapterSummaries）中已出现的人物和事件，也应视为"已介绍"。
</rules>

<severity_levels>
  【分级标准 - 严格按此执行】
  - **error**：严重世界观冲突：
    - 时代背景严重错误（如在前文已确立的时代背景下使用了不符合该时代的元素）
    - 已建立的世界规则被违反（如设定中某人已死却在本章中正常出现）
    - 人物性格完全崩坏（如设定中胆小的人物突然变得无所畏惧且无铺垫）
  - **warning**：轻微设定偏差：
    - 人物言行略有偏差但不影响整体形象
    - 时间线有轻微模糊但不构成矛盾
    - 某个设定细节与原文略有出入
  - **info**：建议性意见：
    - 可以补充设定解释
    - 可以更明确地呼应前文设定
</severity_levels>

<dimensions>
  【幻觉检测维度】
  1. **世界规则冲突**：描述与已建立的世界规则（如魔法体系、科技水平、地理设定）相悖的内容
  1b. **战力体系冲突**：${POWER_SYSTEM_RULES}
   2. **人物性格冲突**：人物言行与其已建立的性格特点不符
  3. **事实矛盾**：与前文已确立的事实相矛盾
  4. **不可能发生**：基于已建立规则，某些事件不可能发生
  5. **未介绍元素**：使用到前文未介绍的人物、地点或物品
     ${FORESHADOW_BOUNDARY_RULES}
     本章对伏笔的揭示如果与埋下时的暗示方向严重不符，报 error
</dimensions>

<important>
  【重要】请严格控制 error 数量，只有严重违反已建立设定的内容才报 error。轻微偏差报 warning，建议性意见报 info。
</important>

<output_format>
  请输出 JSON 格式的检测结果：
  {
    "is_consistent": true或false,
    "issues": [
      {
        "type": "hallucination",
        "severity": "error|warning|info",
        "description": "问题描述",
        "conflict_with": "与什么设定冲突",
        "location": "具体位置",
        "suggestion": "具体的修复建议（如：将不符合时代背景的元素替换为符合该背景的等价物）"
      }
    ]
  }

  如果没有任何冲突，请返回 {"is_consistent": true, "issues": []}。
</output_format>`

    return [
      this.systemMessage(`你是一位严谨的世界观守护者。${SEVERITY_INSTRUCTIONS}`),
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
        suggestion?: string
      }>
    }

    if (data.is_consistent === true) {
      return []
    }

    const withdrawnPattern = /撤回|不成立|不构成严重矛盾|此条不成立|重新审视后|不构成.*矛盾|不视为/i
    const activeIssues = (data.issues || []).filter(issue => {
      const desc = `${issue.description ?? ''} ${issue.suggestion ?? ''}`
      return !withdrawnPattern.test(desc)
    })

    return activeIssues.map(issue => {
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
      if (issue.suggestion) {
        result.suggestion = issue.suggestion
      }
      return result
    })
  }
}

type IssueSeverity = 'error' | 'warning' | 'info'