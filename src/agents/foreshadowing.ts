import type { ModelProvider } from '../model/provider.js'
import { BaseAgent, type AgentOutput } from './base.js'
import type { ForeshadowingAgentInput } from './types.js'
import type { ForeshadowItem, ForeshadowStatus } from '../types/foreshadow.js'
import { generateId } from '../utils/id.js'
import { getChapterPlanningConfig } from '../utils/chapter-planning.js'
import {
  buildForeshadowingSystemPrompt,
  buildForeshadowingUserPrompt,
} from './prompts/foreshadowing-prompt.js'

export class ForeshadowingAgent extends BaseAgent<ForeshadowingAgentInput> {
  private lastTotalChapters: number | undefined

  constructor(provider: ModelProvider) {
    super(provider, 0.3)
  }
  protected buildPrompt(state: ForeshadowingAgentInput): import('../model/provider.js').Message[] {
    const currentChapter = (state.chapterIndex ?? 0) + 1
    this.lastTotalChapters = state.totalChapters ?? currentChapter

    const planningConfig = getChapterPlanningConfig(state.genre ?? 'default')

    return [
      this.systemMessage(buildForeshadowingSystemPrompt()),
      this.userMessage(buildForeshadowingUserPrompt(state, planningConfig)),
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
    void chapterContent
    if (!output.success || !output.data) return existingStack

    const data = output.data as {
      new_foreshadows?: Array<{
        text?: string
        foreshadow_type?: string
        expected_fulfill_chapter?: number
        confidence?: string
      }>
      fulfilled_foreshadows?: Array<string | number>
      overdue_foreshadows?: Array<string | number>
    }

    const currentChapter = chapterIndex + 1
    const planningConfig = getChapterPlanningConfig('default')
    const defaultFulfillDistance = Math.round(
      (planningConfig.foreshadowMinFulfillDistance + planningConfig.foreshadowMaxFulfillDistance) /
        2
    )

    const fulfilledIds = new Set((data.fulfilled_foreshadows ?? []).map((item) => String(item)))

    const updatedStack: ForeshadowItem[] = existingStack.map((item, index) => {
      if (item.fulfilledChapter) return item

      const isFulfilled = fulfilledIds.has(item.id) || fulfilledIds.has(String(index + 1))
      const isOverdue = currentChapter > item.expectedFulfillChapter + 1

      if (isFulfilled || isOverdue) {
        return { ...item, fulfilledChapter: currentChapter } as ForeshadowItem
      }

      return item
    })

    const newItems = (data.new_foreshadows || [])
      .filter((item) => typeof item.text === 'string' && item.text.trim().length > 0)
      .map((item) => {
        const rawExpected = item.expected_fulfill_chapter ?? currentChapter + defaultFulfillDistance
        const farFutureCap = Math.min(
          currentChapter + planningConfig.foreshadowMaxFulfillDistance,
          this.lastTotalChapters ?? currentChapter + planningConfig.foreshadowMaxFulfillDistance
        )
        const expectedFulfillChapter = Math.max(
          currentChapter + planningConfig.foreshadowMinFulfillDistance,
          Math.min(rawExpected, farFutureCap)
        )
        return {
          id: generateId(),
          text: item.text!.trim(),
          expectedFulfillChapter,
          createdAt: Date.now(),
          createdAtChapter: currentChapter,
          status: (item.foreshadow_type === 'explicit' ? 'shown' : 'planted') as ForeshadowStatus,
          isExplicit: item.foreshadow_type === 'explicit',
          source: 'content' as const,
        }
      })

    const unfufilled = updatedStack.filter((item) => !item.fulfilledChapter)
    const fulfilled = updatedStack.filter((item) => item.fulfilledChapter)
    const merged = [...unfufilled, ...fulfilled, ...newItems]
    return merged.slice(0, planningConfig.foreshadowMaxStackSize)
  }
}
