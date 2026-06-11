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

    const userContent = `<instruction>
  请分析以下章节，完成两项任务：1) 检测已埋伏笔是否在本章被回收，2) 在合适的情况下埋下新的伏笔。
  ${isClosingPhase ? `当前已进入收尾阶段（第 ${currentChapter}/${totalChapters} 章，剩余 ${totalChapters - currentChapter} 章）。**禁止埋下新的伏笔**。所有未回收的伏笔必须在本章或剩余章节内回收完毕。new_foreshadows 必须返回空数组 []。` : '请先检查回收，再考虑埋下新伏笔。如果已有大量未回收伏笔，应优先回收而非新增。'}
</instruction>

<anti_pattern>
  <trap>防止"自埋自收"陷阱</trap>
  <description>
    在判断是否需要埋下新伏笔时，请严格区分：
    <genuine>"真正的伏笔"：本章只给出轻微暗示或线索，核心悬念需要在未来章节揭示。例如：角色说了一句意味深长的话、场景中出现了不寻常但未被解释的细节。</genuine>
    <narrative>"本章正常情节推进"：本章已经完整呈现的内容（如本章末尾的预警场景、本章中已经发生的冲突、本章中已经揭示的信息）**不是**伏笔，而是叙事本身。</narrative>
    <rule>如果某个"伏笔"的文本内容就是本章正在描写的情节，这属于"自埋自收"陷阱，**绝对不要**将其标记为新伏笔。</rule>
  </description>
</anti_pattern>

<chapter_content>
  ${state.chapterContent || '（无内容）'}
</chapter_content>

<existing_foreshadows>
  ${existingForeshadows.length > 0
    ? existingForeshadows.map((f, i) => `  <item index="${i + 1}" created_at="${f.createdAtChapter ?? '?'}" expected="${f.expectedFulfillChapter}">${f.text}</item>`).join('\n')
    : '（暂无已埋伏笔）'}
  ${mustFulfillForeshadows.length > 0 ? `
  <must_fulfill>
    ${mustFulfillForeshadows.map((f, i) => `    <item index="${i + 1}" expected="${f.expectedFulfillChapter}" current="${currentChapter}">${f.text}</item>`).join('\n')}
  </must_fulfill>` : ''}
  ${overdueForeshadows.length > 0 ? `
  <overdue>
    ${overdueForeshadows.map((f, i) => `    <item index="${i + 1}" expected="${f.expectedFulfillChapter}" current="${currentChapter}" overdue="${currentChapter - f.expectedFulfillChapter}">${f.text}</item>`).join('\n')}
  </overdue>` : ''}
  ${urgentForeshadows.length > 0 ? `
  <urgent>
    ${urgentForeshadows.map((f, i) => `    <item index="${i + 1}" expected="${f.expectedFulfillChapter}" current="${currentChapter}">${f.text}</item>`).join('\n')}
  </urgent>` : ''}
  ${normalForeshadows.length > 0 ? `
  <normal>
    ${normalForeshadows.map((f, i) => `    <item index="${i + 1}" expected="${f.expectedFulfillChapter}" current="${currentChapter}">${f.text}</item>`).join('\n')}
  </normal>` : ''}
</existing_foreshadows>

<guidelines>
  <foreshadow_types>
    <type>人物言行中暗示未来命运或选择的内容</type>
    <type>环境中不寻常的细节，可能在未来产生重要影响</type>
    <type>人物对话中的承诺、预言、预感</type>
    <type>看似无关紧要的物品、事件在未来可能的关键作用</type>
    <type>人物内心深处的秘密或矛盾</type>
  </foreshadow_types>

  <fulfillment_rules>
    <rule>如果本章中出现了与伏笔含义相关的情节（即使措辞不完全相同），也视为已回收</rule>
    <rule>如果伏笔的核心悬念在本章得到了揭示或呼应，也视为已回收</rule>
    <rule>如果伏笔涉及的人物、物品、事件在本章有重要进展，也视为已回收</rule>
    <rule>不要严格依赖文本完全匹配，要从语义层面判断是否回收</rule>
  </fulfillment_rules>
</guidelines>

<output_format>
  请输出 JSON 格式：
  {
    "new_foreshadows": [
      {
        "text": "伏笔文本内容",
        "foreshadow_type": "character_destiny|environmental_detail|dialogue_hint|object_foreshadow|inner_conflict",
        "expected_fulfill_chapter": 数字,
        "confidence": "high|medium|low"
      }
    ],
    "fulfilled_foreshadows": ["被回收的伏笔文本"],
    "overdue_foreshadows": ["超过预期章节仍未回收的伏笔文本"]
  }
  如果本章没有发现值得埋下的伏笔，new_foreshadows 返回空数组 []。
</output_format>`

    return [
      this.systemMessage('<role>你是一位擅长埋伏笔和制造悬念的作家，擅长在叙述中埋下不引人注意但回味无穷的线索。</role>'),
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