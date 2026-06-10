import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { ForeshadowItem } from '../graph/state.js'
import { generateId } from '../utils/id.js'
import { isSemanticallyRelated } from '../utils/text-similarity.js'

export class ForeshadowingAgent extends BaseAgent {
  private lastTotalChapters: number | undefined

  constructor() {
    super(undefined, 0.3)
  }
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const existingForeshadows = state.foreshadowStack || []
    const currentChapter = (state.chapterIndex ?? 0) + 1
    const totalChapters = state.totalChapters ?? currentChapter
    this.lastTotalChapters = totalChapters

    const noNewThreshold = Math.max(3, Math.floor(totalChapters * 0.15))
    const isClosingPhase = currentChapter > totalChapters - noNewThreshold

    const overdueForeshadows = existingForeshadows.filter(
      f => !f.fulfilledChapter && currentChapter > f.expectedFulfillChapter + 1
    )
    const mustFulfillForeshadows = existingForeshadows.filter(
      f => !f.fulfilledChapter && currentChapter >= f.expectedFulfillChapter && currentChapter <= f.expectedFulfillChapter + 1
    )
    const urgentForeshadows = existingForeshadows.filter(
      f => !f.fulfilledChapter && currentChapter >= f.expectedFulfillChapter - 1 && currentChapter < f.expectedFulfillChapter
    )
    const normalForeshadows = existingForeshadows.filter(
      f => !f.fulfilledChapter && currentChapter < f.expectedFulfillChapter - 1
    )

    const userContent = `请分析以下章节，完成两项任务：1) 检测已埋伏笔是否在本章被回收，2) 埋下新的伏笔。

${isClosingPhase ? `【重要】当前已进入收尾阶段（第 ${currentChapter}/${totalChapters} 章，剩余 ${totalChapters - currentChapter} 章）。**禁止埋下新的伏笔**。所有未回收的伏笔必须在本章或剩余章节内回收完毕。new_foreshadows 必须返回空数组 []。` : '【重要优先级】请先检查回收，再考虑埋下新伏笔。如果已有大量未回收伏笔，应优先回收而非新增。'}

【重要 - 防止自埋自收陷阱】
在判断是否需要埋下新伏笔时，请严格区分：
- "真正的伏笔"：本章只给出轻微暗示或线索，核心悬念需要在未来章节揭示。例如：角色说了一句意味深长的话、场景中出现了不寻常但未被解释的细节。
- "本章正常情节推进"：本章已经完整呈现的内容（如本章末尾的预警场景、本章中已经发生的冲突、本章中已经揭示的信息）**不是**伏笔，而是叙事本身。

**判定标准**：如果某个"伏笔"的文本内容就是本章正在描写的情节（例如本章描写了一个预警场景，又把该预警场景标记为新伏笔），这属于"自埋自收"陷阱，**绝对不要**将其标记为新伏笔。

章节内容：
${state.chapterContent || '（无内容）'}

${
  existingForeshadows.length > 0
    ? `已埋伏笔列表（需要检测是否在本章被回收）：
${existingForeshadows.map((f, i) => `${i + 1}. "${f.text}"（埋于第${f.createdAtChapter ?? '?'}章，预期第${f.expectedFulfillChapter}章回收）`).join('\n')}

请检查本章内容，判断上述伏笔是否已被回收（伏笔情节在本章得到呼应或揭示）。`
    : '(暂无已埋伏笔)'
}

${
  mustFulfillForeshadows.length > 0
    ? `【🚨 必须在本章回收】以下伏笔已到达预期回收章节，必须在本章回收：
${mustFulfillForeshadows.map((f, i) => `  ${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章，当前第${currentChapter}章）`).join('\n')}`
    : ''
}

${
  overdueForeshadows.length > 0
    ? `【⚠️ 已逾期伏笔 - 必须优先处理】以下伏笔已超过预期回收章节，请在本章尽可能回收：
${overdueForeshadows.map((f, i) => `  ${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章，当前第${currentChapter}章，已逾期${currentChapter - f.expectedFulfillChapter}章）`).join('\n')}`
    : ''
}

${
  urgentForeshadows.length > 0
    ? `【🔔 即将到期伏笔 - 建议在本章回收】以下伏笔已接近预期回收章节：
${urgentForeshadows.map((f, i) => `  ${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章，当前第${currentChapter}章）`).join('\n')}`
    : ''
}

${
  normalForeshadows.length > 0
    ? `【正常伏笔 - 暂时无需回收】以下伏笔还有余量，无需在本章回收：
${normalForeshadows.map((f, i) => `  ${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章，当前第${currentChapter}章）`).join('\n')}`
    : ''
}

伏笔识别要求：
1. 人物言行中暗示未来命运或选择的内容
2. 环境中不寻常的细节，可能在未来产生重要影响
3. 人物对话中的承诺、预言、预感
4. 看似无关紧要的物品、事件在未来可能的关键作用
5. 人物内心深处的秘密或矛盾

回收检测要求：
1. 如果本章中出现了与伏笔含义相关的情节（即使措辞不完全相同），也视为已回收
2. 如果伏笔的核心悬念在本章得到了揭示或呼应，也视为已回收
3. 如果伏笔涉及的人物、物品、事件在本章有重要进展，也视为已回收
4. 不要严格依赖文本完全匹配，要从语义层面判断是否回收

请输出 JSON 格式：
{
  "new_foreshadows": [
    {
      "text": "伏笔文本内容",
      "foreshadow_type": "character_destiny|environmental_detail|dialogue_hint|object_foreshadow|inner_conflict",
      "expected_fulfill_chapter": 预期在第几章回收（数字，必须 <= ${totalChapters}）,
      "confidence": "high|medium|low"
    }
  ],
  "fulfilled_foreshadows": [被回收的伏笔文本列表（尽量精确匹配原文）],
  "overdue_foreshadows": [超过预期章节仍未回收的伏笔文本列表]
}

如果本章没有发现值得埋下的伏笔，new_foreshadows 返回空数组 []。`

    return [
      this.systemMessage('你是一位擅长埋伏笔和制造悬念的作家，擅长在叙述中埋下不引人注意但回味无穷的线索。'),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
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

  processOutput(
    output: AgentOutput,
    chapterIndex: number,
    existingStack: ForeshadowItem[],
    chapterContent?: string
  ): ForeshadowItem[] {
    if (!output.success || !output.data) return existingStack

    const data = output.data as {
      new_foreshadows?: Array<{
        text?: string
        foreshadow_type?: string
        expected_fulfill_chapter?: number
        confidence?: string
      }>
      fulfilled_foreshadows?: string[]
      overdue_foreshadows?: string[]
    }

    const currentChapter = chapterIndex + 1

    const updatedStack: ForeshadowItem[] = existingStack.map(item => {
      if (item.fulfilledChapter) return item

      const isFulfilled = data.fulfilled_foreshadows?.some(
        f => isSemanticallyRelated(f, item.text, 0.35)
      )
      const isOverdue = currentChapter > item.expectedFulfillChapter + 1

      if (isFulfilled || isOverdue) {
        return { ...item, fulfilledChapter: currentChapter } as ForeshadowItem
      }

      return item
    })

    const newItems = (data.new_foreshadows || [])
      .filter(item => item.text && item.text.length > 5)
      .filter(item => {
        if (!chapterContent) return true
        const normalizedItem = item.text!.replace(/[^\u4e00-\u9fff]/g, '')
        const normalizedChapter = chapterContent.replace(/[^\u4e00-\u9fff]/g, '')
        if (normalizedItem.length > 5 && normalizedChapter.includes(normalizedItem)) {
          console.log(`[MuseFlow] 伏笔过滤: 剔除本章叙事内容 "${item.text!.substring(0, 30)}..."`)
          return false
        }
        if (item.text!.length < 40) {
          console.log(`[MuseFlow] 伏笔过滤: 剔除短文本叙事细节 "${item.text!.substring(0, 30)}..."`)
          return false
        }
        const isSelfReferential = isSemanticallyRelated(item.text!, chapterContent, 0.5)
        if (isSelfReferential) {
          console.log(`[MuseFlow] 伏笔过滤: 剔除自埋自收陷阱 "${item.text!.substring(0, 30)}..."`)
        }
        return !isSelfReferential
      })
      .map(item => ({
        id: generateId(),
        text: item.text!,
        expectedFulfillChapter: Math.min(
          item.expected_fulfill_chapter ?? currentChapter + 5,
          this.lastTotalChapters ?? currentChapter + 5
        ),
        createdAt: Date.now(),
        createdAtChapter: currentChapter,
        status: (item.foreshadow_type === 'explicit' ? 'shown' : 'planted') as import('../graph/state.js').ForeshadowStatus,
        isExplicit: item.foreshadow_type === 'explicit',
      }))

    const fulfilledCount = updatedStack.filter(item => item.fulfilledChapter && item.fulfilledChapter === currentChapter).length
    if (fulfilledCount > 0) {
      console.log(`[MuseFlow] 伏笔回收: 本章回收 ${fulfilledCount} 个伏笔`)
    }

    const overdueCount = updatedStack.filter(item => !item.fulfilledChapter && currentChapter > item.expectedFulfillChapter + 3).length
    if (overdueCount > 0) {
      console.log(`[MuseFlow] 伏笔逾期: ${overdueCount} 个伏笔超过预期章节仍未回收，已自动标记`)
    }

    const unfufilled = updatedStack.filter(item => !item.fulfilledChapter)
    const fulfilled = updatedStack.filter(item => item.fulfilledChapter)
    const merged = [...unfufilled, ...fulfilled, ...newItems]
    return merged.slice(0, 20)
  }
}