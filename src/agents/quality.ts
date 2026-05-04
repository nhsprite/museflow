import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Issue } from '../types/agent.js'
import { generateId } from '../utils/id.js'

export class QualityAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)
  }
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const userContent = `请对以下章节进行质量评审。

章节内容：
${state.chapterContent || '（无内容）'}

【评审标准 - 严格按此分级】
- **error**：仅限以下严重问题：
  - 情节前后矛盾（如先写"烧退了"后面又写"仍在发烧"）
  - 关键信息缺失导致读者无法理解（如重要物品突然出现却无交代）
  - 叙述视角严重混乱（如第三人称突然跳为第一人称）
- **warning**：一般质量问题：
  - 文笔可以更好（用词重复、句式单调）
  - 节奏偏慢或偏快
  - 人物刻画可以更立体
  - 细节描写有疏漏但不影响理解
- **info**：建议性意见：
  - 伏笔可以更丰富
  - 可以埋下更多悬念

评审维度：
1. **文笔质量**：语言是否流畅、描写是否细腻、用词是否精准
  2. **剧情逻辑**：情节推进是否合理、转折是否突兀
  3. **人物刻画**：对话是否生动、人物是否立体
  4. **节奏把控**：章节节奏是否合适、高潮与铺垫是否平衡
  5. **伏笔呼应**：是否埋下伏笔、是否需要为后续章节留下悬念
  6. **AI 痕迹检测**：
     - 是否出现"值得一提的是"、"不难发现"、"众所周知"、"值得注意的是"等 AI 惯用总结句式
     - 是否出现"让我们回到"、"接下来"、"与此同时"等机械过渡
     - 是否有"这个故事告诉我们"、"从这件事可以看出"等作者跳出来抽象概括的句式
     - 段落是否以具体动作/感官细节开头，而非抽象评价

【重要】请严格控制 error 数量，只有真正影响阅读理解的严重问题才报 error。一般性改进建议请报 warning 或 info。

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
  ],
  "suggestions": ["改进建议1", "改进建议2"]
}`

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

    const issues: Issue[] = (data.issues || []).map(issue => {
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
}

type IssueSeverity = 'error' | 'warning' | 'info'