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
import { normalizeStoryEvents } from '../story-memory/event-contract.js'

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
  private currentChapterIndex = 0

  constructor(provider: ModelProvider) {
    super(provider, 0.3)
  }

  async run(state: SummaryAgentInput): Promise<AgentOutput> {
    this.currentChapterIndex = state.chapterIndex ?? 0
    return super.run(state)
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
      const normalizedEvents = normalizeStoryEvents(parsedEvents.data, {
        chapterIndex: this.currentChapterIndex,
        mode: 'strict',
      })
      storyEvents = normalizedEvents.events
      if (normalizedEvents.invalid.length > 0) {
        logger.warn(
          `[MuseFlow] SummaryAgent 过滤了 ${normalizedEvents.invalid.length} 个无效 storyEvents`
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
