import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Issue } from '../types/agent.js'
import { generateId } from '../utils/id.js'

export class QualityAgent extends BaseAgent {
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const userContent = `请对以下章节进行质量评审。

章节内容：
${state.chapterContent || '（无内容）'}

评审维度：
1. **文笔质量**：语言是否流畅、描写是否细腻、用词是否精准
2. **剧情逻辑**：情节推进是否合理、转折是否突兀
3. **人物刻画**：对话是否生动、人物是否立体
4. **节奏把控**：章节节奏是否合适、高潮与铺垫是否平衡
5. **伏笔呼应**：是否埋下伏笔、是否需要为后续章节留下悬念

请输出 JSON 格式的评审结果：
{
  "quality_score": 1-10 的评分,
  "strengths": ["优点1", "优点2"],
  "issues": [
    {
      "type": "quality",
      "severity": "error|warning|info",
      "description": "问题描述",
      "location": "具体位置或章节"
    }
  ],
  "suggestions": ["改进建议1", "改进建议2"]
}`

    return [
      this.systemMessage('你是一位资深编辑，擅长发现文稿中的质量问题并提供建设性的改进建议。'),
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