import type { ModelProvider } from '../model/provider.js'
import { logger } from '../utils/logger.js'
import { BaseAgent, type AgentOutput } from './base.js'
import type { ForeshadowingAgentInput } from './types.js'
import type { ForeshadowItem, ForeshadowStatus } from '../types/foreshadow.js'
import { generateId } from '../utils/id.js'
import { isSemanticallyRelated } from '../utils/text-similarity.js'
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
    const planningConfig = getChapterPlanningConfig('default')
    const defaultFulfillDistance = Math.round(
      (planningConfig.foreshadowMinFulfillDistance + planningConfig.foreshadowMaxFulfillDistance) / 2
    )

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
          logger.info(`[MuseFlow] 伏笔过滤: 剔除本章叙事内容 "${item.text!.substring(0, 30)}..."`)
          return false
        }
        if (item.text!.length < planningConfig.foreshadowMinLength) {
          logger.info(`[MuseFlow] 伏笔过滤: 剔除短文本叙事细节 "${item.text!.substring(0, 30)}..."`)
          return false
        }
        const isSelfReferential = isSemanticallyRelated(item.text!, chapterContent, 0.5)
        if (isSelfReferential) {
          logger.info(`[MuseFlow] 伏笔过滤: 剔除自埋自收陷阱 "${item.text!.substring(0, 30)}..."`)
        }
        return !isSelfReferential
      })
      .map(item => {
        const rawExpected = item.expected_fulfill_chapter ?? currentChapter + defaultFulfillDistance
        const farFutureCap = Math.min(
          currentChapter + planningConfig.foreshadowMaxFulfillDistance,
          this.lastTotalChapters ?? currentChapter + planningConfig.foreshadowMaxFulfillDistance
        )
        const expectedFulfillChapter = Math.max(currentChapter + planningConfig.foreshadowMinFulfillDistance, Math.min(rawExpected, farFutureCap))
        return {
          id: generateId(),
          text: item.text!,
          expectedFulfillChapter,
          createdAt: Date.now(),
          createdAtChapter: currentChapter,
          status: (item.foreshadow_type === 'explicit' ? 'shown' : 'planted') as ForeshadowStatus,
          isExplicit: item.foreshadow_type === 'explicit',
          source: 'content' as const,
        }
      })

    const fulfilledCount = updatedStack.filter(item => item.fulfilledChapter && item.fulfilledChapter === currentChapter).length
    if (fulfilledCount > 0) {
      logger.info(`[MuseFlow] 伏笔回收: 本章回收 ${fulfilledCount} 个伏笔`)
    }

    const overdueCount = updatedStack.filter(item => !item.fulfilledChapter && currentChapter > item.expectedFulfillChapter + 3).length
    if (overdueCount > 0) {
      logger.info(`[MuseFlow] 伏笔逾期: ${overdueCount} 个伏笔超过预期章节仍未回收，已自动标记`)
    }

    const unfufilled = updatedStack.filter(item => !item.fulfilledChapter)
    const fulfilled = updatedStack.filter(item => item.fulfilledChapter)
    const merged = [...unfufilled, ...fulfilled, ...newItems]
    return merged.slice(0, planningConfig.foreshadowMaxStackSize)
  }
}