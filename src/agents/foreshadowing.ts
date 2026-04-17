import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { ForeshadowItem } from '../graph/state.js'
import { generateId } from '../utils/id.js'

export class ForeshadowingAgent extends BaseAgent {
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const userContent = `请分析以下章节，提取可作为伏笔的元素。

章节内容：
${state.chapterContent || '（无内容）'}

伏笔识别要求：
1. 人物言行中暗示未来命运或选择的内容
2. 环境中不寻常的细节，可能在未来产生重要影响
3. 人物对话中的承诺、预言、预感
4. 看似无关紧要的物品、事件在未来可能的关键作用
5. 人物内心深处的秘密或矛盾

请输出 JSON 格式的伏笔列表：
[
  {
    "text": "伏笔文本内容",
    "foreshadow_type": "character_destiny|environmental_detail|dialogue_hint|object_foreshadow|inner_conflict",
    "expected_fulfill_chapter": 预期在第几章回收（数字）,
    "confidence": "high|medium|low"
  }
]

如果本章没有发现值得埋下的伏笔，请返回空数组 []。`

    return [
      this.systemMessage('你是一位擅长埋伏笔和制造悬念的作家，擅长在叙述中埋下不引人注意但回味无穷的线索。'),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const jsonMatch = trimmed.match(/\[[\s\S]*\]/) || trimmed.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { success: false, error: '无法解析伏笔数据：未找到 JSON 格式' }
    }
    try {
      const data = JSON.parse(jsonMatch[0])
      return { success: true, data }
    } catch {
      return { success: false, error: '无法解析伏笔数据：JSON 格式错误' }
    }
  }

  processOutput(output: AgentOutput, chapterIndex: number, existingStack: ForeshadowItem[]): ForeshadowItem[] {
    if (!output.success || !Array.isArray(output.data)) return existingStack

    const newItems = (output.data as Array<{
      text?: string
      foreshadow_type?: string
      expected_fulfill_chapter?: number
      confidence?: string
    }>)
      .filter(item => item.text && item.text.length > 5)
      .map(item => ({
        id: generateId(),
        text: item.text!,
        expectedFulfillChapter: item.expected_fulfill_chapter ?? chapterIndex + 5,
        createdAt: Date.now(),
      }))

    return [...existingStack, ...newItems].slice(0, 20)
  }
}