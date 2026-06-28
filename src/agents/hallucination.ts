import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Issue } from '../types/agent.js'
import { CAPABILITY_CONSISTENCY_RULES, SEVERITY_INSTRUCTIONS, FORESHADOW_BOUNDARY_RULES, buildCharacterWhitelistSection } from './prompt-fragments.js'
import { parseJsonFromLLM } from '../utils/json.js'
import { normalizeIssues } from '../utils/agent-output.js'

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

${buildCharacterWhitelistSection({
  charactersList: state.charactersList,
  outlineCharacters: state.outlineCharacters,
  establishedCharacters: state.establishedCharacters,
})}

<outline_context>
${state.outline || '（暂无大纲上下文）'}
</outline_context>

${state.chapterSummaries && state.chapterSummaries.length > 0 ? `<chapter_summaries>
${state.chapterSummaries.join('\n---\n')}
</chapter_summaries>

` : ''}<foreshadows>
${activeForeshadows.length > 0
    ? activeForeshadows.map((f, i) => `${i + 1}. "${f.text}"（埋于第${f.createdAtChapter ?? '?'}章，预期第${f.expectedFulfillChapter}章回收）`).join('\n')
    : '（暂无未回收伏笔）'}
</foreshadows>

<content>
${state.chapterContent || '（无内容）'}
</content>

<rules>
  【评判依据边界 - 严格遵守】
  - 你的主要依据包括：上方明确提供的"世界观设定"、"人物设定"、"当前及前章大纲上下文"和"已埋伏笔"。
  - 基本逻辑与常识可作为辅助判断依据。
  - 你**无权**以任何外部来源的信息作为否定本章内容的评判标准。未在上方提供的背景知识、公共知识库中的信息均不得作为判定幻觉的依据。
  - 只有当内容违反**本故事自身**已建立的设定或基本逻辑时，才应报告为幻觉。
  - **重要**：当前及前章大纲上下文中已明确提及的角色、事件和设定，等同于"已介绍元素"，不应再报为"未介绍元素"。
  - **重要**：前面章节摘要（chapterSummaries）中已出现的人物和事件，以及上方【前文已建立角色】列表中的人物，都应视为"已介绍"。
  - 本章首次登场的新角色，如果与已建立设定明显冲突，才报为"未介绍元素"；若只是本章合理引入的配角或路人，不报 error。
</rules>

<severity_levels>
  【分级标准 - 严格按此执行】
  - **error**：严重世界观冲突：
    - 时代背景严重错误
    - 已建立的世界规则被违反
    - 人物性格完全崩坏且无铺垫
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
  1. **世界规则冲突**：描述与已建立的世界规则相悖的内容
  1b. **战力体系/能力状态冲突**：${CAPABILITY_CONSISTENCY_RULES}
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
        "suggestion": "具体的修复建议"
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
    return parseJsonFromLLM(content)
  }

  async processOutput(output: AgentOutput): Promise<Issue[]> {
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

    return normalizeIssues(data.issues, 'hallucination', this.provider)
  }
}