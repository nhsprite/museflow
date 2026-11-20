import { logger } from '../../../utils/logger.js'
import type { ReducedGraphState } from '../../state.js'
import type { ModelProvider } from '../../../model/provider.js'
import type { SummaryAgentInput } from '../../../agents/types.js'
import { getSummaryAgent } from '../../agent-factory.js'
import { generateId } from '../../../utils/id.js'
import { buildEffectiveCharactersList } from '../../utils/characters.js'
import { applyEvents, createEmptyStoryMemory } from '../../../story-memory/projector.js'
import {
  foreshadowMemoryToItem,
  partitionInvalidForeshadowIntroductions,
} from '../../../story-memory/foreshadow-policy.js'
import type { StoryEvent } from '../../../types/story-memory.js'
import type { Issue } from '../../../types/agent.js'
import { getPendingMandatoryBeats } from './act-progress.js'
import {
  deriveVerifiedBeatsFromPlotAdvanceEvents,
  deriveVerifiedMandatoryBeatIdsFromPlotAdvanceEvents,
  filterStoryEventsForEvidence,
  filterStoryEventsForStoryArc,
  filterSummaryFallbackEvents,
  filterSummaryFallbackEventsForAuthority,
  isChapterHandoff,
  isSummaryData,
  updateOutlineVerifiedBeats,
} from './chapter-events.js'
import {
  compareStoryTime,
  formatStoryTime,
  hasStoryTimeEraConflict,
  isEmptyStoryTime,
  normalizeStoryTime,
} from '../../../utils/story-time.js'

export interface ChapterSummaryExtractionInput {
  state: ReducedGraphState
  provider: ModelProvider
  chapterContent: string
  chapter: ReducedGraphState['chapters'][number]
  chapters: ReducedGraphState['chapters']
  outline: ReducedGraphState['outline']
  storyMemory: NonNullable<ReducedGraphState['storyMemory']>
  storyState: ReducedGraphState['storyState']
  draftPlotAdvanceBeatIds: ReadonlySet<string>
}

export interface ChapterSummaryExtractionResult {
  chapter: ReducedGraphState['chapters'][number]
  chapters: ReducedGraphState['chapters']
  outline: ReducedGraphState['outline']
  storyMemory: NonNullable<ReducedGraphState['storyMemory']>
  storyState: ReducedGraphState['storyState']
  newForeshadowIntroduceEvents: Array<Extract<StoryEvent, { type: 'foreshadow-introduce' }>>
  invalidForeshadowDeadlineEvents: Array<Extract<StoryEvent, { type: 'foreshadow-introduce' }>>
  storyTimeIssues: Issue[]
  failureIssue?: Issue
}

export async function extractChapterSummary(
  input: ChapterSummaryExtractionInput
): Promise<ChapterSummaryExtractionResult> {
  const { state, provider, chapterContent, draftPlotAdvanceBeatIds } = input
  const chapterIndex = state.currentChapterIndex
  let updatedChapter = input.chapter
  const updatedChapters = [...input.chapters]
  let updatedOutline = input.outline
  let updatedStoryMemory = input.storyMemory
  let updatedStoryState = input.storyState
  const newForeshadowIntroduceEvents: Array<Extract<StoryEvent, { type: 'foreshadow-introduce' }>> =
    []
  const invalidForeshadowDeadlineEvents: Array<
    Extract<StoryEvent, { type: 'foreshadow-introduce' }>
  > = []
  const storyTimeIssues: Issue[] = []

  const result = (): ChapterSummaryExtractionResult => ({
    chapter: updatedChapter,
    chapters: updatedChapters,
    outline: updatedOutline,
    storyMemory: updatedStoryMemory,
    storyState: updatedStoryState,
    newForeshadowIntroduceEvents,
    invalidForeshadowDeadlineEvents,
    storyTimeIssues,
  })

  if (!updatedChapter || updatedChapter.summary) return result()

  let summary = ''
  const summaryAgent = getSummaryAgent(provider)
  const {
    merged: effectiveCharacters,
    outline: outlineCharacters,
    established: establishedCharacters,
  } = buildEffectiveCharactersList(state, chapterIndex)
  const currentOutline = updatedOutline[chapterIndex]
  const beatsToVerify =
    currentOutline?.claimedBeats && currentOutline.claimedBeats.length > 0
      ? currentOutline.claimedBeats
      : getPendingMandatoryBeats(state, chapterIndex)
  const claimedMandatoryBeatIds = currentOutline?.claimedMandatoryBeatIds ?? []
  const plannedFallbackItems =
    state.chapterPlan?.chapterIndex === chapterIndex
      ? state.chapterPlan.fulfilledForeshadowIds.flatMap((id) => {
          const memory = updatedStoryMemory.foreshadows[id]
          return memory && memory.fulfilledIn === null ? [foreshadowMemoryToItem(memory)] : []
        })
      : []
  const plannedFallbackForeshadows = plannedFallbackItems.map(({ id, text }) => ({ id, text }))
  const summaryState: SummaryAgentInput = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    chapterContent,
    charactersList: effectiveCharacters,
    outlineCharacters,
    establishedCharacters,
    plannedForeshadowFulfillments: plannedFallbackForeshadows,
    ...(currentOutline?.title ? { chapterTitle: currentOutline.title } : {}),
    chapterIndex,
    ...(beatsToVerify.length > 0 ? { claimedBeats: beatsToVerify } : {}),
    ...(claimedMandatoryBeatIds.length > 0 ? { claimedMandatoryBeatIds } : {}),
  }

  const MAX_SUMMARY_RETRIES = 2
  let summarySuccess = false
  for (let attempt = 0; attempt <= MAX_SUMMARY_RETRIES; attempt++) {
    if (attempt > 0) {
      logger.info(
        `[MuseFlow] 第 ${chapterIndex + 1} 章摘要生成失败，第 ${attempt}/${MAX_SUMMARY_RETRIES} 次重试...`
      )
    }
    try {
      const summaryOutput = await summaryAgent.run(summaryState)
      if (!summaryOutput.success) {
        logger.warn(
          `[MuseFlow] 第 ${chapterIndex + 1} 章摘要 agent 返回失败: ${summaryOutput.error || '未知错误'}`
        )
        continue
      }
      const summaryData = isSummaryData(summaryOutput.data) ? summaryOutput.data : undefined
      if (!summaryData || !summaryData.chapterSummary) {
        logger.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章摘要处理结果为空`)
        continue
      }
      summary = summaryData.chapterSummary
      updatedChapter = updatedChapter ? { ...updatedChapter, summary } : null
      updatedChapters[chapterIndex] = updatedChapter
      summarySuccess = true
      if (isChapterHandoff(summaryData.chapterHandoff) && updatedStoryState) {
        const nextStoryTime = normalizeStoryTime(summaryData.chapterHandoff.endTime)
        if (!isEmptyStoryTime(nextStoryTime) && !isEmptyStoryTime(state.storyState?.storyTime)) {
          if (hasStoryTimeEraConflict(state.storyState?.storyTime, nextStoryTime)) {
            storyTimeIssues.push({
              id: `time-era-conflict-${chapterIndex}-${generateId()}`,
              ruleId: 'structured.time-era-conflict',
              type: 'state_conflict',
              severity: 'error',
              description: `第 ${chapterIndex + 1} 章断言的故事时间（${formatStoryTime(nextStoryTime)}）与运行中的故事年份（${formatStoryTime(state.storyState?.storyTime)}）年号不一致。注意：文中档案/公文的历史日期不是故事时间，只有故事自身时钟的章末时刻才应进入该断言。`,
              suggestion:
                '若本章正文确实改元/更换纪元，请人工确认后强制定稿；否则修正章节内容或摘要中的故事时间断言。',
              source: 'state_reconciliation',
              retryStrategy: 'manual',
            })
          } else if (compareStoryTime(state.storyState?.storyTime, nextStoryTime) === 'earlier') {
            storyTimeIssues.push({
              id: `time-regression-${chapterIndex}-${generateId()}`,
              ruleId: 'structured.time-regression',
              type: 'state_conflict',
              severity: 'error',
              description: `第 ${chapterIndex + 1} 章的章末故事时间（${formatStoryTime(nextStoryTime)}）早于上一章结束时间（${formatStoryTime(state.storyState?.storyTime)}），故事时钟不得倒退。`,
              suggestion:
                '修正本章的故事时间断言（摘要 endTime 的结构化字段），使其不早于上一章结束时间；若正文确实时间倒退，请先修正正文。',
              source: 'state_reconciliation',
              retryStrategy: 'manual',
            })
          }
        }
        updatedStoryState = {
          ...updatedStoryState,
          chapterHandoff: {
            ...summaryData.chapterHandoff,
            endTime: nextStoryTime,
          },
          ...(!isEmptyStoryTime(nextStoryTime) ? { storyTime: nextStoryTime } : {}),
        }
      }

      const summaryEventCandidates = filterSummaryFallbackEvents(
        filterStoryEventsForEvidence(
          filterStoryEventsForStoryArc(summaryData.storyEvents ?? [], state.storyArc),
          chapterContent
        ),
        chapterIndex,
        new Set(updatedStoryMemory.events.map((event) => event.id))
      )
      const authorizedSummaryEventCandidates = filterSummaryFallbackEventsForAuthority(
        {
          ...state,
          storyMemory: updatedStoryMemory,
          storyState: updatedStoryState,
        },
        summaryEventCandidates,
        chapterIndex
      )
      const { valid: actualEvents, invalid: invalidSummaryForeshadows } =
        partitionInvalidForeshadowIntroductions(authorizedSummaryEventCandidates)
      invalidForeshadowDeadlineEvents.push(...invalidSummaryForeshadows)
      const newEvents = actualEvents.filter((event) => {
        if (event.type === 'plot-advance') {
          return !draftPlotAdvanceBeatIds.has(event.beatId)
        }
        return true
      })
      if (newEvents.length > 0) {
        newForeshadowIntroduceEvents.push(
          ...newEvents.filter(
            (event): event is Extract<StoryEvent, { type: 'foreshadow-introduce' }> =>
              event.type === 'foreshadow-introduce'
          )
        )
        updatedStoryMemory = applyEvents(updatedStoryMemory ?? createEmptyStoryMemory(), newEvents)
        logger.info(
          `[MuseFlow] 第 ${chapterIndex + 1} 章已从摘要补充 ${newEvents.length} 个 storyEvents`
        )
      }

      const summaryVerifiedBeats = deriveVerifiedBeatsFromPlotAdvanceEvents(
        newEvents,
        state.storyArc
      )
      const summaryVerifiedMandatoryBeatIds = deriveVerifiedMandatoryBeatIdsFromPlotAdvanceEvents(
        newEvents,
        state.storyArc
      )
      if (summaryVerifiedBeats.length > 0 || summaryVerifiedMandatoryBeatIds.length > 0) {
        updatedOutline = updateOutlineVerifiedBeats(
          updatedOutline,
          chapterIndex,
          summaryVerifiedBeats,
          summaryVerifiedMandatoryBeatIds
        )
      }

      break
    } catch (err) {
      logger.warn(
        `[MuseFlow] 生成第 ${chapterIndex + 1} 章摘要失败 (attempt ${attempt + 1}/${MAX_SUMMARY_RETRIES + 1}):`,
        err
      )
    }
  }

  if (!summarySuccess) {
    logger.warn(
      `[MuseFlow] 第 ${chapterIndex + 1} 章摘要生成最终失败，已阻止 finalize，避免未沉淀内容进入后续章节。`
    )
    return {
      ...result(),
      failureIssue: {
        id: generateId(),
        ruleId: 'finalization.state-extraction',
        type: 'state_corruption',
        severity: 'error',
        description: `第 ${chapterIndex + 1} 章摘要提取失败，无法安全进入下一章。`,
        suggestion:
          '请重试当前章节 finalize；如果模型持续失败，请检查模型输出或运行 rewrite 重新生成本章。',
        source: 'state_reconciliation',
        retryStrategy: 'manual',
      },
    }
  }

  return result()
}
