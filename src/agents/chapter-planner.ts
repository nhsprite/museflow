import type { ModelProvider } from '../model/provider.js'
import { logger } from '../utils/logger.js'
import { BaseAgent, type AgentOutput } from './base.js'
import type { ChapterPlannerAgentInput, ChapterPlan } from './types.js'
import type { StoryEvent } from '../types/story-memory.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import { getChapterPlanningConfig } from '../utils/chapter-planning.js'
import { parseJsonFromLLM } from '../utils/json.js'
import {
  DEFAULT_CHAPTER_PLANNING_WORD_COUNT_MIN,
  DEFAULT_CHAPTER_PLANNING_WORD_COUNT_MAX,
} from '../types/genre.js'
import {
  buildChapterPlannerSystemPrompt,
  buildChapterPlannerUserPrompt,
} from './prompts/chapter-planner-prompt.js'

export { type ChapterPlan } from './types.js'

const STORY_EVENT_TYPES = [
  'character-location',
  'character-status',
  'item-location',
  'item-state',
  'plot-advance',
  'foreshadow-introduce',
  'foreshadow-fulfill',
  'task-create',
  'task-resolve',
] as const

function isStoryEvent(e: unknown): e is StoryEvent {
  if (!e || typeof e !== 'object') return false
  const event = e as Record<string, unknown>
  if (typeof event.id !== 'string') return false
  if (typeof event.type !== 'string') return false
  if (typeof event.chapterIndex !== 'number') return false
  if ('source' in event && event.source !== 'chapter' && event.source !== 'outline') return false
  return (STORY_EVENT_TYPES as readonly string[]).includes(event.type)
}

export class ChapterPlannerAgent extends BaseAgent<ChapterPlannerAgentInput> {
  constructor(provider: ModelProvider) {
    super(provider, 0.3)
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
    const expectedEvents = Array.isArray(data.expectedEvents)
      ? data.expectedEvents.filter(isStoryEvent)
      : []
    if (data.expectedEvents && expectedEvents.length < data.expectedEvents.length) {
      logger.warn(
        `[MuseFlow] 过滤了 ${data.expectedEvents.length - expectedEvents.length} 个无效 expectedEvents`
      )
    }

    const plan: ChapterPlan = {
      chapterIndex: data.chapterIndex ?? 0,
      sections: data.sections,
      timeline: data.timeline,
      outlineCheck: data.outlineCheck,
      expectedEvents,
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
