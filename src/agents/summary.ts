import { logger } from '../utils/logger.js'
import type { ModelProvider } from '../model/provider.js'
import { BaseAgent, type AgentOutput } from './base.js'
import type { SummaryAgentInput } from './types.js'
import type { Message } from '../model/provider.js'

import {
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
  buildClaimedBeatsSection,
  buildPlannedForeshadowsSection,
  buildCharacterWhitelistSection,
} from './prompts/summary-prompt.js'
import { parseJsonFromLLM } from '../utils/json.js'
import type { StoryEvent } from '../types/story-memory.js'
import type { ChapterHandoff } from '../types/story-state.js'

const SUMMARY_EVENT_TYPES = [
  'character-location',
  'character-status',
  'item-location',
  'item-state',
  'plot-advance',
  'foreshadow-introduce',
  'foreshadow-fulfill',
  'task-resolve',
  'task-create',
] as const

function isStoryEvent(e: unknown): e is StoryEvent {
  if (!e || typeof e !== 'object') return false
  const event = e as Record<string, unknown>
  if (typeof event.id !== 'string') return false
  if (typeof event.type !== 'string') return false
  if (typeof event.chapterIndex !== 'number') return false
  if (!('source' in event) || (event.source !== 'chapter' && event.source !== 'outline'))
    return false
  if (!(SUMMARY_EVENT_TYPES as readonly string[]).includes(event.type)) return false

  switch (event.type) {
    case 'character-location':
      return (
        typeof event.characterId === 'string' &&
        (event.locationId === null || typeof event.locationId === 'string')
      )
    case 'character-status':
      return (
        typeof event.characterId === 'string' &&
        typeof event.attribute === 'string' &&
        'value' in event
      )
    case 'item-location':
      return (
        typeof event.itemId === 'string' &&
        (event.holderId === null || typeof event.holderId === 'string') &&
        (event.locationId === null || typeof event.locationId === 'string')
      )
    case 'item-state':
      return (
        typeof event.itemId === 'string' && typeof event.attribute === 'string' && 'value' in event
      )
    case 'plot-advance':
      return typeof event.plotId === 'string' && typeof event.beatId === 'string'
    case 'foreshadow-introduce':
      return (
        typeof event.foreshadowId === 'string' &&
        (event.expectedFulfillChapter === null || typeof event.expectedFulfillChapter === 'number')
      )
    case 'foreshadow-fulfill':
      return typeof event.foreshadowId === 'string'
    case 'task-resolve':
      return typeof event.taskId === 'string'
    case 'task-create':
      return typeof event.taskId === 'string' && typeof event.description === 'string'
    default:
      return false
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isChapterHandoff(value: unknown): value is ChapterHandoff {
  if (!value || typeof value !== 'object') return false
  const handoff = value as Record<string, unknown>
  return (
    typeof handoff.chapterNumber === 'number' &&
    typeof handoff.endScene === 'string' &&
    typeof handoff.endTime === 'string' &&
    isStringArray(handoff.charactersPresent) &&
    typeof handoff.lastAction === 'string' &&
    isStringArray(handoff.openQuestions) &&
    (!('requiredNextOpening' in handoff) || typeof handoff.requiredNextOpening === 'string')
  )
}

export class SummaryAgent extends BaseAgent<SummaryAgentInput> {
  constructor(provider: ModelProvider) {
    super(provider, 0.3)
  }

  protected buildPrompt(state: SummaryAgentInput): Message[] {
    const whitelistSection = buildCharacterWhitelistSection({
      charactersList: state.charactersList,
      outlineCharacters: state.outlineCharacters,
      establishedCharacters: state.establishedCharacters,
    })

    const userContent = buildSummaryUserPrompt(
      {
        claimedBeatsSection: buildClaimedBeatsSection(
          state.claimedBeats ?? [],
          state.claimedMandatoryBeatIds ?? []
        ),
        plannedForeshadowsSection: buildPlannedForeshadowsSection(
          state.plannedForeshadowFulfillments ?? []
        ),
        whitelistSection,
      },
      {
        chapterTitle: state.chapterTitle ?? '未知',
        displayChapterNumber:
          state.chapterIndex !== undefined ? `第${state.chapterIndex + 1}章` : '未知',
        chapterContent: state.chapterContent ?? '（无内容）',
      }
    )

    return [this.systemMessage(buildSummarySystemPrompt()), this.userMessage(userContent)]
  }

  protected parse(content: string): AgentOutput {
    const summaryMatch = content.match(/<chapter_summary>([\s\S]*?)<\/chapter_summary>/i)
    const handoffMatch = content.match(/<chapter_handoff>([\s\S]*?)<\/chapter_handoff>/i)
    const eventsMatch = content.match(/<story_events>([\s\S]*?)<\/story_events>/i)

    const chapterSummary = summaryMatch?.[1]?.trim() ?? ''
    const handoffText = handoffMatch?.[1]?.trim()
    const eventsText = eventsMatch?.[1]?.trim() ?? '[]'

    let chapterHandoff: ChapterHandoff | undefined
    if (handoffText) {
      const parsedHandoff = parseJsonFromLLM<unknown>(handoffText)
      if (parsedHandoff.success && isChapterHandoff(parsedHandoff.data)) {
        chapterHandoff = parsedHandoff.data
      } else {
        logger.warn('[MuseFlow] SummaryAgent 忽略了无效 chapter_handoff')
      }
    }

    let storyEvents: StoryEvent[] = []
    const parsedEvents = parseJsonFromLLM<unknown[]>(eventsText)
    if (parsedEvents.success && Array.isArray(parsedEvents.data)) {
      storyEvents = parsedEvents.data.filter(isStoryEvent)
      if (storyEvents.length < parsedEvents.data.length) {
        logger.warn(
          `[MuseFlow] SummaryAgent 过滤了 ${parsedEvents.data.length - storyEvents.length} 个无效 storyEvents`
        )
      }
    }

    return {
      success: true,
      data: {
        storyEvents,
        chapterSummary,
        ...(chapterHandoff ? { chapterHandoff } : {}),
      },
    }
  }
}
