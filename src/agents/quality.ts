import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Issue } from '../types/agent.js'
import { AI_PHRASE_PROHIBITIONS, SEVERITY_INSTRUCTIONS } from './prompt-fragments.js'
import { parseJsonFromLLM } from '../utils/json.js'
import { normalizeIssues, isPositiveFeedback } from '../utils/agent-output.js'

export class QualityAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)
  }
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const userContent = `<prompt>
  <task>请对以下章节进行质量评审</task>
  
  <chapter_content>
${state.chapterContent || '（无内容）'}
  </chapter_content>

  <rating_criteria>
    <severity level="error">
      仅限以下严重问题：
      - 情节前后矛盾
      - 关键信息缺失导致读者无法理解
      - 叙述视角严重混乱
      - 语义自相矛盾：同一段落中先描述某事物处于状态A，紧接着又描述其处于相反状态B，且没有合理的过渡或解释
      - 语义混乱的病句：句子内部逻辑冲突，导致读者无法判断真实状态
    </severity>
    <severity level="warning">
      一般质量问题：
      - 文笔可以更好（用词重复、句式单调）
      - 节奏偏慢或偏快
      - 人物刻画可以更立体
      - 细节描写有疏漏但不影响理解
    </severity>
    <severity level="info">
      建议性意见：
      - 伏笔可以更丰富
      - 可以埋下更多悬念
    </severity>
  </rating_criteria>

  <review_dimensions>
    <dimension name="文笔质量">
      语言是否流畅、描写是否细腻、用词是否精准
    </dimension>
    <dimension name="剧情逻辑">
      情节推进是否合理、转折是否突兀
    </dimension>
    <dimension name="人物刻画">
      对话是否生动、人物是否立体
    </dimension>
    <dimension name="节奏把控">
      章节节奏是否合适、高潮与铺垫是否平衡
    </dimension>
    <dimension name="语义一致性">
      检查是否存在以下严重语义问题：
      - 自相矛盾：同一事物在短时间内被描述为两种互斥状态，且没有因果过渡
      - 语义混乱：句子结构导致读者无法判断真实状态
      - 状态漂移：关键物品/角色的状态在同一章内发生无理由的反复变化
    </dimension>
    <dimension name="AI痕迹检测">
      ${AI_PHRASE_PROHIBITIONS}
    </dimension>
  </review_dimensions>

  <important_rules>
    ${SEVERITY_INSTRUCTIONS}
  </important_rules>

  <output_format>
请输出 JSON 格式的评审结果：
{
  "quality_score": 1-10 的评分,
  "strengths": ["优点1", "优点2"],
  "issues": [
    {
      "type": "quality",
      "severity": "error|warning|info",
      "description": "问题描述",
      "location": "具体位置或章节",
      "suggestion": "具体的修复建议（如：将'值得一提的是'改为具体的人物动作或场景描写）"
    }
  ],
  "suggestions": ["改进建议1", "改进建议2"]
}
  </output_format>
</prompt>`

    return [
      this.systemMessage(`你是一位资深编辑，擅长发现文稿中的质量问题。${SEVERITY_INSTRUCTIONS}`),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    return parseJsonFromLLM(content)
  }

  processOutput(output: AgentOutput): { issues: Issue[]; qualityScore?: number } {
    if (!output.success || !output.data) return { issues: [] }
    const data = output.data as {
      quality_score?: number
      issues?: Array<{
        type?: string
        severity?: string
        description?: string
        location?: string
        suggestion?: string
      }>
    }

    const issues = normalizeIssues(data.issues, 'quality', {
      defaultSeverity: 'info',
      filter: issue => !isPositiveFeedback(issue.description || ''),
    })

    const result: { issues: Issue[]; qualityScore?: number } = { issues }
    if (data.quality_score !== undefined) {
      result.qualityScore = data.quality_score
    }
    return result
  }
}