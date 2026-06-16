import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Issue } from '../types/agent.js'
import { generateId } from '../utils/id.js'

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
      - 情节前后矛盾（如先写"烧退了"后面又写"仍在发烧"）
      - 关键信息缺失导致读者无法理解（如重要物品突然出现却无交代）
      - 叙述视角严重混乱（如第三人称突然跳为第一人称）
      - 语义自相矛盾：同一段落中先描述某事物处于状态A，紧接着又描述其处于相反状态B，且没有合理的过渡或解释（如"裂纹已愈合"紧接着"裂纹更深了"）
      - 语义混乱的病句：句子内部逻辑冲突，导致读者无法判断真实状态（如"虽经修复又被毁去修复"）
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
      - 自相矛盾：同一事物在短时间内被描述为两种互斥状态（如先写"已修复"紧接着写"损坏更严重"），且没有因果过渡
      - 语义混乱：句子结构导致读者无法判断真实状态（如"虽经A修复又被B毁去修复，真正状态存疑"）
      - 状态漂移：关键物品/角色的状态在同一章内发生无理由的反复变化
    </dimension>
    <dimension name="AI痕迹检测">
      - 是否出现"值得一提的是"、"不难发现"、"众所周知"、"值得注意的是"等 AI 惯用总结句式
      - 是否出现"让我们回到"、"接下来"、"与此同时"等机械过渡
      - 是否有"这个故事告诉我们"、"从这件事可以看出"等作者跳出来抽象概括的句式
      - 段落是否以具体动作/感官细节开头，而非抽象评价
    </dimension>
  </review_dimensions>

  <important_rules>
    <rule>请严格控制 error 数量，只有真正影响阅读理解的严重问题才报 error。一般性改进建议报 warning 或 info。</rule>
    <rule>issues 数组只放需要改进的问题。</rule>
    <rule>正面评价（如"未检测到 AI 痕迹""语言流畅""描写细腻"等）必须放入 strengths，严禁放入 issues。</rule>
    <rule>如果某个维度没有问题，直接不写对应的 issue，不要写"未发现问题"的 issue。</rule>
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
      this.systemMessage('你是一位资深编辑，擅长发现文稿中的质量问题。你的评审标准是：只有真正影响阅读理解的严重逻辑矛盾才报 error，一般性质量问题报 warning，建议性意见报 info。请严格控制 error 数量。'),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { success: false, error: '无法解析评审数据：未找到 JSON 格式' }
    }
    try {
      const data = JSON.parse(jsonMatch[0])
      return { success: true, data }
    } catch {
      return { success: false, error: '无法解析评审数据：JSON 格式错误' }
    }
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

    const issues: Issue[] = (data.issues || [])
      .filter(issue => !this.isPositiveFeedback(issue.description || ''))
      .map(issue => {
        const result: Issue = {
          id: generateId(),
          type: 'quality',
          severity: (issue.severity as IssueSeverity) || 'info',
          description: issue.description || '',
        }
        if (issue.location) {
          result.location = issue.location
        }
        if (issue.suggestion) {
          result.suggestion = issue.suggestion
        }
        return result
      })

    const result: { issues: Issue[]; qualityScore?: number } = { issues }
    if (data.quality_score !== undefined) {
      result.qualityScore = data.quality_score
    }
    return result
  }

  private isPositiveFeedback(description: string): boolean {
    const positivePatterns = [
      /未检测到.*AI痕迹/,
      /未检测到.*问题/,
      /未发现问题/,
      /没有.*问题/,
      /没有.*痕迹/,
      /保持.*较好/,
      /保持.*良好/,
      /语言.*流畅/,
      /描写.*细腻/,
      /文笔.*优秀/,
      /文笔.*出色/,
      /节奏.*恰当/,
      /结构.*合理/,
      /人物.*立体/,
      /情节.*合理/,
      /无明显/,
      /无.*不足/,
      /值得肯定/,
      /表现.*优秀/,
      /质量.*较高/,
    ]
    return positivePatterns.some(pattern => pattern.test(description))
  }
}

type IssueSeverity = 'error' | 'warning' | 'info'