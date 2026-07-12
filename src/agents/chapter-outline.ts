import type { ModelProvider } from '../model/provider.js'
import { BaseAgent, type AgentOutput } from './base.js'
import type { ChapterOutlineAgentInput } from './types.js'
import type { ChapterOutline, ActArc, StoryArc } from '../types/outline.js'
import { parseJsonFromLLM } from '../utils/json.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import { calculateBeatBudget, isClosingPhase } from '../utils/story-arc.js'
import { getChapterPlanningConfig } from '../utils/chapter-planning.js'
import {
  buildChapterOutlineSystemPrompt,
  buildChapterOutlineUserPrompt,
  type ChapterOutlinePromptSections,
} from './prompts/chapter-outline-prompt.js'
import { getMandatoryBeatIdByText } from '../utils/mandatory-beat-ids.js'

export interface ChapterOutlineResult extends ChapterOutline {
  conflict?: boolean
  conflictReason?: string
}

export class ChapterOutlineAgent extends BaseAgent<ChapterOutlineAgentInput> {
  constructor(provider: ModelProvider) {
    super(provider, 0.4)
  }

  protected buildPrompt(state: ChapterOutlineAgentInput): import('../model/provider.js').Message[] {
    const chapterIndex = state.chapterIndex ?? 0
    const displayChapterNumber = toDisplayChapterNumber(chapterIndex)
    const storyArc = state.storyArc
    const act = this.getCurrentAct(storyArc, chapterIndex)
    const nextAct = this.getNextAct(storyArc, chapterIndex)
    const actProgress = state.actProgress ?? {}
    const actProgressForAct = act ? actProgress[act.index] : undefined

    const pendingBeats = actProgressForAct?.pending ?? act?.mandatoryBeats ?? []
    const consumedBeats = actProgressForAct?.consumed ?? []
    const beatBudget = act ? calculateBeatBudget(act, chapterIndex, pendingBeats) : 0

    const formatMandatoryBeatList = (beats: string[]): string =>
      beats.length > 0
        ? beats
            .map((beat) => {
              const id = act ? getMandatoryBeatIdByText(storyArc, act.index, beat) : undefined
              return id ? `- ${id}: ${beat}` : `- ${beat}`
            })
            .join('\n')
        : '（无）'

    const actSection = act
      ? `<current_act>
幕标题：${act.title}
主题：${act.theme}
叙事功能：${act.function}
章节范围：第${act.startChapter}章 – 第${act.endChapter}章
当前章号：第${displayChapterNumber}章
本章在该幕中的位置：第 ${chapterIndex + 1 - act.startChapter + 1} / ${act.endChapter - act.startChapter + 1} 章
尚未消费的 mandatory beats：
${formatMandatoryBeatList(pendingBeats)}
已消费的 mandatory beats：
${formatMandatoryBeatList(consumedBeats)}
本章节拍预算：${beatBudget > 0 ? `本章 description 最多承载 ${beatBudget} 个 mandatory beat` : '（暂无剩余节拍可领）'}
</current_act>`
      : '<current_act>（暂无幕信息）</current_act>'

    const nextActSection = nextAct
      ? `<next_act_boundary>
下一幕标题：${nextAct.title}
下一幕主题：${nextAct.theme}
下一幕叙事功能：${nextAct.function}
下一幕从第${nextAct.startChapter}章开始。
【强制要求】本章不得提前执行下一幕的叙事功能，只能在本幕范围内推进，并为下一幕保留合理过渡空间。
</next_act_boundary>`
      : '<next_act_boundary>（已无后续幕）</next_act_boundary>'

    const planningConfig = getChapterPlanningConfig(state.genre)
    const closingPhaseSection = isClosingPhase(
      state.totalChapters,
      chapterIndex,
      planningConfig.closingPhaseRatio
    )
      ? `<closing_phase>
【全书收尾阶段】本书仅剩 ${state.totalChapters - chapterIndex} 章结束。
- 禁止引入新的主要支线、新角色或新的未解悬念。
- 必须优先推进仍未消费的 mandatory beats 和 key beats。
- 必须向最终高潮/结局推进，不得扩展无关过渡场景。
</closing_phase>`
      : ''

    const sections: ChapterOutlinePromptSections = {
      actSection,
      nextActSection,
      closingPhaseSection,
    }

    return [
      this.systemMessage(buildChapterOutlineSystemPrompt()),
      this.userMessage(buildChapterOutlineUserPrompt(state, sections)),
    ]
  }

  private getCurrentAct(storyArc: StoryArc | undefined, chapterIndex: number): ActArc | undefined {
    if (!storyArc) return undefined
    const chapterNumber = chapterIndex + 1
    return storyArc.acts.find(
      (a) => chapterNumber >= a.startChapter && chapterNumber <= a.endChapter
    )
  }

  private getNextAct(storyArc: StoryArc | undefined, chapterIndex: number): ActArc | undefined {
    if (!storyArc) return undefined
    const chapterNumber = chapterIndex + 1
    return storyArc.acts.find((a) => a.startChapter > chapterNumber)
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const baseError = (message: string, error?: unknown): AgentOutput => ({
      success: false,
      content,
      error: error instanceof Error ? `${message}: ${error.message}` : message,
    })

    const parsed = parseJsonFromLLM<ChapterOutlineResult>(trimmed)
    if (!parsed.success) {
      return baseError('无法解析章节大纲：JSON 格式错误')
    }

    const data = parsed.data
    if (!data || typeof data.title !== 'string' || typeof data.description !== 'string') {
      return baseError('章节大纲格式错误：缺少 title 或 description')
    }

    const normalizeStringArray = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []

    return {
      success: true,
      data: {
        title: data.title.trim(),
        description: data.description.trim(),
        introducedCharacters: normalizeStringArray(data.introducedCharacters),
        claimedBeats: normalizeStringArray(data.claimedBeats),
        claimedMandatoryBeatIds: normalizeStringArray(data.claimedMandatoryBeatIds),
        conflict: data.conflict === true,
        conflictReason: data.conflictReason ?? '',
        touchedCharacterIds: normalizeStringArray(data.touchedCharacterIds),
        touchedItemIds: normalizeStringArray(data.touchedItemIds),
        touchedLocationIds: normalizeStringArray(data.touchedLocationIds),
        claimedBeatIds: normalizeStringArray(data.claimedBeatIds),
        fulfilledForeshadowIds: normalizeStringArray(data.fulfilledForeshadowIds),
        deferredForeshadowIds: normalizeStringArray(data.deferredForeshadowIds),
        introducedForeshadowIds: normalizeStringArray(data.introducedForeshadowIds),
        resolvedTaskIds: normalizeStringArray(data.resolvedTaskIds),
        createdTaskIds: normalizeStringArray(data.createdTaskIds),
      },
    }
  }
}
