import type { ModelProvider } from '../model/provider.js'
import { logger } from '../utils/logger.js'
import { BaseAgent, type AgentOutput } from './base.js'
import type { ChapterPlannerAgentInput, ChapterPlan } from './types.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import { getChapterPlanningConfig } from '../utils/chapter-planning.js'
import { parseJsonFromLLM } from '../utils/json.js'
import { normalizeStoryEvents } from '../story-memory/event-contract.js'
import {
  DEFAULT_CHAPTER_PLANNING_WORD_COUNT_MIN,
  DEFAULT_CHAPTER_PLANNING_WORD_COUNT_MAX,
} from '../types/genre.js'
import {
  buildChapterPlannerSystemPrompt,
  buildChapterPlannerUserPrompt,
} from './prompts/chapter-planner-prompt.js'

export { type ChapterPlan } from './types.js'

export class ChapterPlannerAgent extends BaseAgent<ChapterPlannerAgentInput> {
  private currentChapterIndex = 0

  constructor(provider: ModelProvider) {
    super(provider, 0.3)
  }

  async run(state: ChapterPlannerAgentInput): Promise<AgentOutput> {
    this.currentChapterIndex = state.chapterIndex ?? 0
    return super.run(state)
  }

  protected buildPrompt(state: ChapterPlannerAgentInput): import('../model/provider.js').Message[] {
    const chapterIndex = state.chapterIndex ?? 0
    const displayChapterNumber = toDisplayChapterNumber(chapterIndex)
    const genreSkill = this.getGenre(state.genre)
    const planningConfig = getChapterPlanningConfig(state.genre)
    const chapterWordCountMin =
      genreSkill?.chapterWordCountMin ?? DEFAULT_CHAPTER_PLANNING_WORD_COUNT_MIN
    const chapterWordCountMax =
      genreSkill?.chapterWordCountMax ?? DEFAULT_CHAPTER_PLANNING_WORD_COUNT_MAX

    return [
      this.systemMessage(buildChapterPlannerSystemPrompt()),
      this.userMessage(
        buildChapterPlannerUserPrompt(
          state,
          planningConfig,
          chapterWordCountMin,
          chapterWordCountMax,
          displayChapterNumber
        )
      ),
    ]
  }

  protected parse(content: string): AgentOutput {
    const parsed = parseJsonFromLLM<Partial<ChapterPlan>>(content)
    if (!parsed.success) {
      logger.error('[MuseFlow] 章节规划 JSON 解析失败')
      return { success: false, error: parsed.error ?? '无法解析规划数据：JSON 格式错误' }
    }

    const data = parsed.data
    if (!data) {
      return { success: false, error: '无法解析规划数据：JSON 为空' }
    }
    if (!data.sections || !Array.isArray(data.sections)) {
      return { success: false, error: '规划数据缺少 sections 字段' }
    }
    if (!data.timeline || !Array.isArray(data.timeline)) {
      return { success: false, error: '规划数据缺少 timeline 字段' }
    }
    if (!data.outlineCheck || !Array.isArray(data.outlineCheck)) {
      data.outlineCheck = []
    }
    const unfulfilled = data.outlineCheck.filter((c) => !c.fulfilled)
    if (unfulfilled.length > 0) {
      logger.warn(`[MuseFlow] 规划警告：${unfulfilled.length} 项大纲要求未在规划中明确落实`)
      for (const u of unfulfilled) {
        logger.warn(`  - ${u.requirement}`)
      }
    }
    const rawExpectedEvents = Array.isArray(data.expectedEvents) ? data.expectedEvents : []
    const normalizedEvents = normalizeStoryEvents(rawExpectedEvents, {
      chapterIndex: this.currentChapterIndex,
      mode: 'strict',
    })
    if (normalizedEvents.invalid.length > 0) {
      const first = normalizedEvents.invalid[0]!
      return {
        success: false,
        error: `expectedEvents[${first.index}] 格式错误：${first.reason}`,
      }
    }

    const plan: ChapterPlan = {
      chapterIndex: data.chapterIndex ?? 0,
      sections: data.sections,
      timeline: data.timeline,
      outlineCheck: data.outlineCheck,
      // Keep validated raw indexes until the graph boundary records any
      // structural conflicts, then planning.ts applies the authoritative index.
      expectedEvents: normalizedEvents.events.map((event, index) => ({
        ...event,
        chapterIndex: rawExpectedEvents[index]!.chapterIndex,
      })),
      claimedMandatoryBeatIds: data.claimedMandatoryBeatIds ?? [],
      claimedBeatIds: data.claimedBeatIds ?? [],
      fulfilledForeshadowIds: data.fulfilledForeshadowIds ?? [],
      introducedForeshadowIds: data.introducedForeshadowIds ?? [],
      resolvedTaskIds: data.resolvedTaskIds ?? [],
      createdTaskIds: data.createdTaskIds ?? [],
    }
    if (data.taskResolutions !== undefined) {
      plan.taskResolutions = data.taskResolutions
    }
    if (data.chapterTimeAnchor !== undefined) {
      plan.chapterTimeAnchor = data.chapterTimeAnchor
    }
    return { success: true, data: plan }
  }
}
