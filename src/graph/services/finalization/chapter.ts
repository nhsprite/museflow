import { logger } from '../../../utils/logger.js'
import type { ReducedGraphState } from '../../state.js'
import type { SummaryAgentInput } from '../../../agents/types.js'
import { getSummaryAgent } from '../../agent-factory.js'
import {
  applyEvents,
  createEmptyStoryMemory,
  ensureBeatsHaveActIndex,
  projectStoryStateFromMemory,
} from '../../../story-memory/projector.js'
import type { StoryEvent } from '../../../types/story-memory.js'
import type { ChapterHandoff } from '../../../types/story-state.js'
import { readChapterContentForRun } from '../../../storage/filesystem/writer.js'
import {
  classifyForeshadows,
  foreshadowMemoryToItem,
  getBoundaryBlockingForeshadows,
  partitionInvalidForeshadowIntroductions,
  projectForeshadowStack,
} from '../../../story-memory/foreshadow-policy.js'
import { generateId } from '../../../utils/id.js'
import { agePendingTasks } from '../../../utils/pending-tasks.js'
import { buildEffectiveCharactersList } from '../../utils/characters.js'
import {
  createEmptyChapterReport,
  summarizeIssues,
  type StateCorrection,
  type ChapterReport,
} from '../../../types/chapter-report.js'
import { countChineseWords } from '../../../utils/text.js'
import type { ActArc, StoryArc } from '../../../types/outline.js'
import type { Issue } from '../../../types/agent.js'
import {
  buildClosingPhaseConstraint,
  proposeActBoundaryAdjustments,
  applyActBoundaryAdjustment,
  formatActBoundaryAdjustmentCommand,
} from '../../../utils/story-arc.js'
import { getChapterPlanningConfig } from '../../../utils/chapter-planning.js'
import {
  clampForeshadowDeadlineToBoundary,
  resolveStoryBoundaryChapter,
} from '../../../story-memory/foreshadow-deadline-boundary.js'
import { loadConfig } from '../../../config/store.js'
import {
  createGenericVerifiedConstraint,
  filterVerifiedConstraintsForChapter,
} from '../../../utils/verified-constraints.js'
import { rebuildStoryMemoryVerifiedConstraints } from '../../../utils/story-memory-constraints.js'
import { mergeStoryState } from '../../utils/reconciler/state-merge.js'
import { createEmptyStoryState } from '../../../storage/meta/stores/story-state.js'
import {
  getActForChapter,
  getPendingMandatoryBeats,
  pruneResolvedOutlineCoverageIssues,
  updateActProgress,
} from './act-progress.js'
import { countEvidenceParagraphs } from '../../../story-memory/validator.js'
import {
  findMandatoryBeatById,
  getMandatoryBeatEntries,
  getMandatoryBeatTextById,
} from '../../../utils/mandatory-beat-ids.js'
import { reconcileForeshadowEquivalence } from '../foreshadow-equivalence/reconcile.js'
import { ForeshadowEquivalenceError } from '../foreshadow-equivalence/detector.js'

function ensureOutlineLength(
  outline: ReducedGraphState['outline'],
  totalChapters: number
): ReducedGraphState['outline'] {
  const next = [...outline]
  for (let i = next.length; i < totalChapters; i++) {
    next.push({ number: i + 1, title: '', description: '' })
  }
  return next
}

function deriveVerifiedBeatsFromPlotAdvanceEvents(
  events: StoryEvent[],
  storyArc: StoryArc | null | undefined
): string[] {
  const beatIdToText = new Map(storyArc?.keyBeats.map((kb) => [kb.id, kb.beat]) ?? [])
  return events
    .filter((e): e is StoryEvent & { type: 'plot-advance' } => e.type === 'plot-advance')
    .map((e) => getMandatoryBeatTextById(storyArc, e.beatId) ?? beatIdToText.get(e.beatId))
    .filter((b): b is string => !!b)
}

function deriveVerifiedMandatoryBeatIdsFromPlotAdvanceEvents(
  events: StoryEvent[],
  storyArc: StoryArc | null | undefined
): string[] {
  const verified = new Set<string>()
  for (const event of events) {
    if (event.type !== 'plot-advance') continue
    if (findMandatoryBeatById(storyArc, event.beatId)) {
      verified.add(event.beatId)
    }
  }
  return Array.from(verified)
}

function updateOutlineVerifiedBeats(
  outline: ReducedGraphState['outline'],
  chapterIndex: number,
  verifiedBeats: string[],
  verifiedMandatoryBeatIds: string[] = []
): ReducedGraphState['outline'] {
  const currentOutline = outline[chapterIndex]
  if (!currentOutline || (verifiedBeats.length === 0 && verifiedMandatoryBeatIds.length === 0)) {
    return outline
  }
  const merged = Array.from(new Set([...(currentOutline.verifiedBeats ?? []), ...verifiedBeats]))
  const mergedIds = Array.from(
    new Set([...(currentOutline.verifiedMandatoryBeatIds ?? []), ...verifiedMandatoryBeatIds])
  )
  const next = [...outline]
  next[chapterIndex] = {
    ...currentOutline,
    ...(merged.length > 0 ? { verifiedBeats: merged } : {}),
    ...(mergedIds.length > 0 ? { verifiedMandatoryBeatIds: mergedIds } : {}),
  }
  return next
}

function filterStoryEventsForStoryArc(
  events: StoryEvent[],
  storyArc: StoryArc | null | undefined
): StoryEvent[] {
  if (!storyArc || storyArc.keyBeats.length === 0) return events
  const validBeatIds = new Set([
    ...storyArc.keyBeats.map((beat) => beat.id),
    ...getMandatoryBeatEntries(storyArc).map((beat) => beat.id),
  ])
  return events.filter((event) => event.type !== 'plot-advance' || validBeatIds.has(event.beatId))
}

function filterStoryEventsForEvidence(events: StoryEvent[], chapterContent: string): StoryEvent[] {
  const paragraphCount = countEvidenceParagraphs(chapterContent)
  return events.filter((event) => {
    const evidence = event.evidence
    return (
      !!evidence &&
      Number.isInteger(evidence.paragraphIndex) &&
      evidence.paragraphIndex >= 1 &&
      evidence.paragraphIndex <= paragraphCount
    )
  })
}

const FORBIDDEN_SUMMARY_FALLBACK_EVENT_TYPES: ReadonlySet<StoryEvent['type']> = new Set([
  // 禁止 SummaryAgent 从 prose 中脑补新伏笔；新伏笔必须由 writer 显式埋下。
  'foreshadow-introduce',
  // 回收事件必须由 writer 声明并通过结构化语义门禁，SummaryAgent 不得旁路补提。
  'foreshadow-fulfill',
  // 伏笔 deadline 延长是定稿调度决策，不应由 SummaryAgent 产生。
  'foreshadow-deadline-extend',
  // 放弃回收是作者决策（CLI），agent 无权产生。
  'foreshadow-waive',
  // 等价合并是定稿门禁的审计决策，SummaryAgent 不得产生。
  'foreshadow-merge',
])

function filterSummaryFallbackEvents(
  events: StoryEvent[],
  chapterIndex: number,
  existingEventIds: ReadonlySet<string>
): StoryEvent[] {
  const seenEventIds = new Set(existingEventIds)
  return events.filter((event) => {
    if (event.source !== 'chapter' || event.chapterIndex !== chapterIndex) return false
    if (seenEventIds.has(event.id)) return false
    // SummaryAgent 作为事件补提 fallback，禁止脑补新伏笔或调度决策类事件；
    // plot-advance 已通过 filterStoryEventsForStoryArc 校验为已知 beat，允许补提。
    if (FORBIDDEN_SUMMARY_FALLBACK_EVENT_TYPES.has(event.type)) return false
    seenEventIds.add(event.id)
    return true
  })
}

function ensureChaptersLength(
  chapters: ReducedGraphState['chapters'],
  totalChapters: number
): ReducedGraphState['chapters'] {
  const next = [...chapters]
  while (next.length < totalChapters) {
    next.push(null)
  }
  return next
}

function buildActBoundaryPendingIssue(storyId: string, act: ActArc, pendingBeats: string[]): Issue {
  const extensionChapters = Math.min(2, Math.max(1, pendingBeats.length))
  const rewriteCommand = `museflow rewrite ${storyId} -c ${act.endChapter}`
  const proposal = {
    actIndex: act.index,
    proposedEndChapter: act.endChapter + extensionChapters,
    reason: `第 ${act.index} 幕结束时仍有 mandatory beats 未消费。`,
  }

  return {
    id: `act-${act.index}-pending-beats-at-boundary`,
    type: 'outline_coverage',
    severity: 'error',
    subject: `act-${act.index}`,
    description: `第 ${act.index} 幕已到结束章节第 ${act.endChapter} 章，但仍有 ${pendingBeats.length} 个 mandatory beats 未消费：${pendingBeats.join('、')}。不能在本幕未完成时进入下一幕；请运行 ${rewriteCommand} 重写本幕末章，或运行 ${formatActBoundaryAdjustmentCommand(storyId, proposal)} 延长本幕后再继续。`,
    suggestion: `运行 ${rewriteCommand} 重写当前章节，或运行 ${formatActBoundaryAdjustmentCommand(storyId, proposal)} 延长本幕。`,
    source: 'outline_compliance',
    retryStrategy: 'manual',
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

function isSummaryData(data: unknown): data is {
  storyEvents?: StoryEvent[]
  chapterSummary?: string
  chapterHandoff?: ChapterHandoff
} {
  return (
    typeof data === 'object' && data !== null && ('storyEvents' in data || 'chapterSummary' in data)
  )
}

export async function finalizeChapter(
  state: ReducedGraphState,
  provider: import('../../../model/provider.js').ModelProvider
): Promise<Partial<ReducedGraphState>> {
  const chapterIndex = state.currentChapterIndex
  const existingChapter = state.chapters[chapterIndex]
  let updatedChapter = existingChapter ? { ...existingChapter } : null
  let updatedOutline = [...state.outline]
  let updatedChapters = [...state.chapters]

  const chapterContent = await readChapterContentForRun(state.story.outputDir, chapterIndex + 1)
  if (chapterContent === null || chapterContent.trim().length === 0) {
    throw new Error(`第 ${chapterIndex + 1} 章文件为空或不存在，无法标记为完成。请重试撰写。`)
  }

  const pendingErrors = state.pendingIssues.filter((i) => i.severity === 'error')
  if (pendingErrors.length > 0) {
    logger.warn(
      `[MuseFlow] 第 ${chapterIndex + 1} 章存在 ${pendingErrors.length} 个未解决的严重问题，跳过 finalize，避免未验证内容进入 storyState。`
    )
    return {
      pendingIssues: state.pendingIssues,
      rewriteRequested: true,
    }
  }

  let updatedStoryState = state.storyState

  // Persist the reconciler's canonical/superseded facts. The reconciler only
  // renders them into prompts; without this merge the authoritative-fact layer
  // never reaches the checkpoint. mergeStoryState is idempotent for repeated
  // deltas (same subject+attribute+value replaces, never duplicates).
  const canonicalFactsDelta = state.canonicalFactsDelta ?? []
  const supersededFactsDelta = state.supersededFactsDelta ?? []
  if (canonicalFactsDelta.length > 0 || supersededFactsDelta.length > 0) {
    updatedStoryState = mergeStoryState(updatedStoryState ?? null, {
      ...createEmptyStoryState(),
      ...(canonicalFactsDelta.length > 0 ? { canonicalFacts: canonicalFactsDelta } : {}),
      ...(supersededFactsDelta.length > 0 ? { supersededFacts: supersededFactsDelta } : {}),
    })
  }
  const hasInputStoryMemory = state.storyMemory !== null && state.storyMemory !== undefined
  let updatedStoryMemory = ensureBeatsHaveActIndex(
    state.storyMemory ?? createEmptyStoryMemory(),
    state.storyArc
  )
  const invalidForeshadowDeadlineEvents: Array<
    Extract<StoryEvent, { type: 'foreshadow-introduce' }>
  > = []
  const newForeshadowIntroduceEvents: Array<Extract<StoryEvent, { type: 'foreshadow-introduce' }>> =
    []
  let updatedForeshadowEquivalenceAudit: ReducedGraphState['foreshadowEquivalenceAudit']

  // Authoritative source of events: the writer already emitted them in the
  // STORY_EVENTS block. Apply them before asking SummaryAgent to avoid losing
  // structured plot-advance events and to skip prose-based guessing.
  const draftEventCandidates = filterStoryEventsForEvidence(
    filterStoryEventsForStoryArc(state.draftChapterEvents ?? [], state.storyArc),
    chapterContent
  )
  const { valid: draftEvents, invalid: invalidDraftForeshadows } =
    partitionInvalidForeshadowIntroductions(draftEventCandidates)
  invalidForeshadowDeadlineEvents.push(...invalidDraftForeshadows)
  const draftPlotAdvanceBeatIds = new Set(
    draftEvents
      .filter((e): e is StoryEvent & { type: 'plot-advance' } => e.type === 'plot-advance')
      .map((e) => e.beatId)
  )
  if (draftEvents.length > 0) {
    newForeshadowIntroduceEvents.push(
      ...draftEvents.filter(
        (e): e is Extract<StoryEvent, { type: 'foreshadow-introduce' }> =>
          e.type === 'foreshadow-introduce'
      )
    )
    if (newForeshadowIntroduceEvents.length > 0) {
      try {
        const reconciled = await reconcileForeshadowEquivalence({
          provider,
          memory: updatedStoryMemory,
          chapterIndex,
          ...(state.foreshadowEquivalenceAudit !== undefined
            ? { audit: state.foreshadowEquivalenceAudit }
            : {}),
          proposedEvents: draftEvents,
        })
        updatedStoryMemory = reconciled.memory
        updatedForeshadowEquivalenceAudit = reconciled.audit
        if (reconciled.mergeEvents.length > 0) {
          for (const event of reconciled.mergeEvents) {
            logger.info(
              `[MuseFlow] 伏笔等价合并 ${event.duplicateForeshadowId} -> ${event.canonicalForeshadowId}`
            )
          }
          logger.info(
            `[MuseFlow] 伏笔等价审计：活跃规范义务 ${reconciled.audit.activeCanonicalIds.length + reconciled.mergeEvents.length} -> ${reconciled.audit.activeCanonicalIds.length}`
          )
        }
      } catch (error) {
        if (!(error instanceof ForeshadowEquivalenceError)) throw error
        return {
          pendingIssues: [
            ...state.pendingIssues,
            {
              id: `foreshadow-equivalence-failed-${chapterIndex}-${generateId()}`,
              type: 'foreshadow_equivalence_failed',
              severity: 'error',
              description: `第 ${chapterIndex + 1} 章伏笔等价检测失败：${error.message}`,
              source: 'foreshadowing',
              retryStrategy: 'manual',
            },
          ],
          rewriteRequested: true,
        }
      }
    } else {
      updatedStoryMemory = applyEvents(updatedStoryMemory, draftEvents)
    }
    const draftVerifiedBeats = deriveVerifiedBeatsFromPlotAdvanceEvents(draftEvents, state.storyArc)
    const draftVerifiedMandatoryBeatIds = deriveVerifiedMandatoryBeatIdsFromPlotAdvanceEvents(
      draftEvents,
      state.storyArc
    )
    if (draftVerifiedBeats.length > 0 || draftVerifiedMandatoryBeatIds.length > 0) {
      updatedOutline = updateOutlineVerifiedBeats(
        updatedOutline,
        chapterIndex,
        draftVerifiedBeats,
        draftVerifiedMandatoryBeatIds
      )
      logger.info(
        `[MuseFlow] 第 ${chapterIndex + 1} 章已从 draft 事件消费 ${draftVerifiedBeats.length} 个 mandatory beats`
      )
    }
  }

  if (updatedChapter) {
    let summary = updatedChapter.summary || ''
    const needsSummary = !summary && chapterContent
    if (needsSummary) {
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
          updatedChapter = { ...updatedChapter, summary }
          updatedChapters[chapterIndex] = updatedChapter
          summarySuccess = true
          if (isChapterHandoff(summaryData.chapterHandoff) && updatedStoryState) {
            updatedStoryState = {
              ...updatedStoryState,
              chapterHandoff: summaryData.chapterHandoff,
              ...(summaryData.chapterHandoff.endTime
                ? { storyTime: summaryData.chapterHandoff.endTime }
                : {}),
            }
          }

          // SummaryAgent events are a fallback for events the writer missed.
          // For plot-advance, draft events are authoritative; skip duplicates.
          const summaryEventCandidates = filterSummaryFallbackEvents(
            filterStoryEventsForEvidence(
              filterStoryEventsForStoryArc(summaryData.storyEvents ?? [], state.storyArc),
              chapterContent
            ),
            chapterIndex,
            new Set(updatedStoryMemory.events.map((event) => event.id))
          )
          const { valid: actualEvents, invalid: invalidSummaryForeshadows } =
            partitionInvalidForeshadowIntroductions(summaryEventCandidates)
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
                (e): e is Extract<StoryEvent, { type: 'foreshadow-introduce' }> =>
                  e.type === 'foreshadow-introduce'
              )
            )
            updatedStoryMemory = applyEvents(
              updatedStoryMemory ?? createEmptyStoryMemory(),
              newEvents
            )
            logger.info(
              `[MuseFlow] 第 ${chapterIndex + 1} 章已从摘要补充 ${newEvents.length} 个 storyEvents`
            )
          }

          const summaryVerifiedBeats = deriveVerifiedBeatsFromPlotAdvanceEvents(
            newEvents,
            state.storyArc
          )
          const summaryVerifiedMandatoryBeatIds =
            deriveVerifiedMandatoryBeatIdsFromPlotAdvanceEvents(newEvents, state.storyArc)
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
          pendingIssues: [
            ...state.pendingIssues,
            {
              id: generateId(),
              type: 'state_corruption',
              severity: 'error',
              description: `第 ${chapterIndex + 1} 章摘要提取失败，无法安全进入下一章。`,
              suggestion:
                '请重试当前章节 finalize；如果模型持续失败，请检查模型输出或运行 rewrite 重新生成本章。',
              source: 'state_reconciliation',
              retryStrategy: 'manual',
            },
          ],
        }
      }
    }
  }

  const planningConfig = getChapterPlanningConfig(state.genre)
  const storyBoundaryChapter = resolveStoryBoundaryChapter({
    runtimeTotalChapters: state.totalChapters,
    storyTotalChapters: state.story.totalChapters,
    storyArc: state.storyArc,
  })

  // Negotiated foreshadow scheduling: when the chapter outline deferred a
  // severely overdue required foreshadow, extend its deadline through the
  // event log so the projection (and the memory→meta sync below) stays
  // consistent across rewrites. Extensions are bounded; at the limit the
  // foreshadow is surfaced for manual attention without blocking the chapter.
  const MAX_FORESHADOW_DEADLINE_EXTENSIONS = 2
  const foreshadowsNeedingAttention: string[] = []
  const deferredForeshadowIds = updatedOutline[chapterIndex]?.deferredForeshadowIds ?? []
  if (deferredForeshadowIds.length > 0) {
    const currentChapterNumber = chapterIndex + 1
    const extendEvents: Array<Extract<StoryEvent, { type: 'foreshadow-deadline-extend' }>> = []
    for (const foreshadowId of deferredForeshadowIds) {
      const memory = updatedStoryMemory.foreshadows[foreshadowId]
      if (!memory || memory.resolutionPolicy !== 'must_resolve' || memory.fulfilledIn !== null) {
        continue
      }
      if (memory.expectedFulfillChapter === null) continue
      if (
        currentChapterNumber <=
        memory.expectedFulfillChapter + planningConfig.foreshadowMaxFulfillDistance
      ) {
        continue
      }
      const extensions = memory.deadlineExtensions ?? 0
      if (extensions >= MAX_FORESHADOW_DEADLINE_EXTENSIONS) {
        foreshadowsNeedingAttention.push(foreshadowId)
        logger.warn(
          `[MuseFlow] 伏笔 ${foreshadowId} 已达 deadline 顺延上限（${MAX_FORESHADOW_DEADLINE_EXTENSIONS} 次）且仍严重逾期，请作者人工关注其回收安排。`
        )
        continue
      }
      extendEvents.push({
        id: generateId('evt'),
        type: 'foreshadow-deadline-extend',
        foreshadowId,
        chapterIndex,
        source: 'outline',
        newExpectedFulfillChapter: clampForeshadowDeadlineToBoundary(
          currentChapterNumber + planningConfig.foreshadowMaxFulfillDistance,
          storyBoundaryChapter
        ),
      })
    }
    if (extendEvents.length > 0) {
      updatedStoryMemory = applyEvents(updatedStoryMemory, extendEvents)
      for (const event of extendEvents) {
        logger.info(
          `[MuseFlow] 伏笔 ${event.foreshadowId} 已顺延 deadline 至第 ${event.newExpectedFulfillChapter} 章（第 ${updatedStoryMemory.foreshadows[event.foreshadowId]?.deadlineExtensions ?? 0} 次顺延）`
        )
      }
    }
  }

  let updatedForeshadowStack = state.foreshadowStack
  if (updatedStoryMemory) {
    const memoryForeshadows = Object.values(updatedStoryMemory.foreshadows)
    updatedForeshadowStack =
      hasInputStoryMemory || memoryForeshadows.length > 0
        ? projectForeshadowStack(updatedStoryMemory)
        : state.foreshadowStack
    updatedStoryState = projectStoryStateFromMemory(updatedStoryMemory, updatedStoryState)
  }

  const currentDisplayChapter = chapterIndex + 1
  if (updatedStoryState) {
    const agedTasks = agePendingTasks(updatedStoryState.pendingTasks, currentDisplayChapter)
    const hasAgedTasks = agedTasks.some((task, index) => {
      const original = updatedStoryState.pendingTasks[index]
      return original !== undefined && task.status !== original.status
    })
    if (hasAgedTasks) {
      updatedStoryState = { ...updatedStoryState, pendingTasks: agedTasks }
    }
  }

  const snapshot: import('../../../types/timeline.js').StateSnapshot = {
    id: generateId('ts'),
    storyId: state.story.id,
    chapterNumber: chapterIndex + 1,
    snapshotType: 'chapter_complete',
    currentChapterIndex: chapterIndex,
    chapterTitle: updatedOutline[chapterIndex]?.title ?? null,
    chapterSummary: updatedChapter?.summary ?? null,
    wordCount: null,
    stateSummary: null,
    issuesResolved: state.pendingIssues.filter((i) => i.severity !== 'error').length,
    issuesPending: state.pendingIssues.filter((i) => i.severity === 'error').length,
    stateJson: null,
    createdAt: Date.now(),
  }
  const updatedTimeline = [...(state.timeline ?? []), snapshot]

  let updatedVerifiedConstraints = rebuildStoryMemoryVerifiedConstraints({
    existingConstraints: state.verifiedConstraints,
    memory: updatedStoryMemory,
    foreshadowStack: updatedForeshadowStack,
    // An explicitly present (even empty) StoryMemory remains authoritative.
    // Only checkpoints with no StoryMemory retain legacy stack boundaries.
    foreshadowStackSource: hasInputStoryMemory ? 'canonical_memory' : 'legacy_compatibility',
    currentChapter: currentDisplayChapter,
  })

  const stateForActProgress: ReducedGraphState = {
    ...state,
    outline: updatedOutline,
    chapters: updatedChapters,
    storyState: updatedStoryState,
    storyMemory: updatedStoryMemory,
    foreshadowStack: updatedForeshadowStack,
  }

  const {
    actProgress: updatedActProgress,
    beatPressureConstraint,
    beatVerificationIssues,
  } = await updateActProgress(stateForActProgress, chapterIndex, provider)
  if (beatPressureConstraint) {
    updatedVerifiedConstraints = [...updatedVerifiedConstraints, beatPressureConstraint]
  }

  const closingPhaseConstraint = state.storyArc
    ? buildClosingPhaseConstraint(
        state.storyArc,
        updatedActProgress,
        chapterIndex,
        planningConfig.closingPhaseRatio
      )
    : undefined
  if (closingPhaseConstraint) {
    updatedVerifiedConstraints = [
      ...updatedVerifiedConstraints,
      createGenericVerifiedConstraint(closingPhaseConstraint),
    ]
  }

  // Avoid stacking duplicate unverified-beat warnings across chapters. The
  // issue IDs are deterministic, so replace any previous warning for the same
  // act/beat with the current chapter's assessment.
  const newIssueIds = new Set(beatVerificationIssues?.map((i) => i.id) ?? [])
  let updatedPendingIssues = state.pendingIssues.filter((i) => !newIssueIds.has(i.id))
  if (beatVerificationIssues && beatVerificationIssues.length > 0) {
    updatedPendingIssues = [...updatedPendingIssues, ...beatVerificationIssues]
  }
  if (invalidForeshadowDeadlineEvents.length > 0) {
    updatedPendingIssues = [
      ...updatedPendingIssues,
      ...invalidForeshadowDeadlineEvents.map((event) => ({
        id: `invalid-foreshadow-deadline-${event.id}`,
        type: 'foreshadow_invalid_deadline' as const,
        severity: 'error' as const,
        description: `伏笔 ${event.foreshadowId} 的预期回收章节 ${String(event.expectedFulfillChapter)} 必须晚于引入章节 ${event.chapterIndex + 1}`,
        subject: event.foreshadowId,
        location: `第 ${chapterIndex + 1} 章`,
        source: 'foreshadowing' as const,
        retryStrategy: 'draft' as const,
      })),
    ]
  }
  const acts = state.storyArc?.acts ?? []
  const finalActIndex = acts.at(-1)?.index
  const currentAct = getActForChapter(state.storyArc, chapterIndex)
  // Only meaningful with multiple acts: in a degenerate single-act story every
  // chapter is "the final act", which would ban all foreshadow introductions.
  if (
    acts.length > 1 &&
    currentAct &&
    finalActIndex !== undefined &&
    currentAct.index === finalActIndex &&
    newForeshadowIntroduceEvents.length > 0
  ) {
    const ids = newForeshadowIntroduceEvents.map((event) => event.foreshadowId)
    updatedPendingIssues = [
      ...updatedPendingIssues,
      {
        id: `final-act-new-foreshadow-${chapterIndex}-${generateId()}`,
        type: 'foreshadow_final_act_introduce' as const,
        severity: 'error' as const,
        description: `最终幕不得引入新伏笔：${ids.join('、')}。请修改本章正文或大纲，将相关内容改为既有线索的回收、场景氛围描写或人物心理刻画。`,
        subject: ids.join('、'),
        location: `第 ${chapterIndex + 1} 章`,
        source: 'foreshadowing' as const,
        retryStrategy: 'draft' as const,
      },
    ]
  }
  updatedPendingIssues = pruneResolvedOutlineCoverageIssues(
    updatedPendingIssues,
    state.storyArc,
    updatedActProgress,
    chapterIndex,
    updatedStoryMemory
  )
  const actBoundaryIssueIds = new Set(
    (state.storyArc?.acts ?? []).map((act) => `act-${act.index}-pending-beats-at-boundary`)
  )
  updatedPendingIssues = updatedPendingIssues.filter((issue) => !actBoundaryIssueIds.has(issue.id))

  const nextIndex = state.currentChapterIndex + 1

  let updatedStoryArc: StoryArc | null | undefined = state.storyArc
  let boundaryProposals: ReturnType<typeof proposeActBoundaryAdjustments> = []
  let updatedTotalChapters = state.totalChapters
  let updatedStory = state.story

  if (state.storyArc) {
    boundaryProposals = proposeActBoundaryAdjustments(
      state.storyArc,
      updatedActProgress,
      chapterIndex,
      updatedStoryMemory
    )
    if (boundaryProposals.length > 0) {
      const config = loadConfig()

      if (config.autoAdjustActBoundaries) {
        for (const proposal of boundaryProposals) {
          const result = applyActBoundaryAdjustment(
            updatedStoryArc ?? state.storyArc,
            proposal,
            chapterIndex
          )
          if (result.applied) {
            updatedStoryArc = result.storyArc
            logger.info(`[MuseFlow] ${result.reason}`)
          } else {
            logger.warn(`[MuseFlow] 自动调整第 ${proposal.actIndex} 幕边界失败：${result.reason}`)
            logger.warn(
              `[MuseFlow] 建议运行：${formatActBoundaryAdjustmentCommand(state.story.id, proposal)}`
            )
            if (result.requiresManualResolution) {
              updatedPendingIssues = [
                ...updatedPendingIssues,
                {
                  id: `auto-extension-limit-${proposal.actIndex}-${generateId()}`,
                  type: 'outline_coverage',
                  severity: 'error',
                  description: `第 ${proposal.actIndex} 幕自动延长已达到上限，仍有 mandatory beats 未消费。`,
                  suggestion:
                    result.reason ?? '请重写当前章节消费 pending beats，或人工调整大纲/幕边界。',
                  source: 'outline_compliance',
                  retryStrategy: 'manual',
                },
              ]
            }
          }
        }
      } else {
        logger.warn('[MuseFlow] 检测到幕边界调整建议：')
        for (const proposal of boundaryProposals) {
          logger.warn(
            `  - 第 ${proposal.actIndex} 幕建议结束于第 ${proposal.proposedEndChapter} 章：${proposal.reason}`
          )
        }
        logger.warn(
          '  如要采纳，请运行：museflow adjust-act <story-id> --act <index> --end-chapter <number>'
        )
      }
    }
  }

  const finalizedAct = getActForChapter(updatedStoryArc, chapterIndex)
  if (finalizedAct && chapterIndex + 1 >= finalizedAct.endChapter) {
    const finalizedProgress = updatedActProgress[finalizedAct.index] ?? {
      consumed: [],
      pending: [...finalizedAct.mandatoryBeats],
    }
    if (finalizedProgress.pending.length > 0) {
      updatedPendingIssues = [
        ...updatedPendingIssues,
        buildActBoundaryPendingIssue(state.story.id, finalizedAct, finalizedProgress.pending),
      ]
    }
  }

  const isStoryEnd = chapterIndex + 1 >= updatedTotalChapters
  const isActBoundary = finalizedAct !== undefined && chapterIndex + 1 >= finalizedAct.endChapter
  if (isActBoundary || isStoryEnd) {
    const boundaryActIndex =
      finalizedAct?.index ?? Math.max(0, ...(updatedStoryArc?.acts.map((act) => act.index) ?? []))
    const unresolvedForeshadows = getBoundaryBlockingForeshadows(
      updatedStoryMemory,
      chapterIndex + 1,
      isStoryEnd
    )
    if (unresolvedForeshadows.length > 0) {
      updatedPendingIssues = [
        ...updatedPendingIssues,
        ...unresolvedForeshadows.map((foreshadowId) => ({
          id: `foreshadow-boundary-unresolved-${foreshadowId}-${chapterIndex}`,
          type: 'foreshadow_boundary_unresolved' as const,
          severity: 'error' as const,
          description: isStoryEnd
            ? `全书结尾仍有必需伏笔 ${foreshadowId} 未回收`
            : `第 ${boundaryActIndex} 幕结束时仍有该幕必需伏笔 ${foreshadowId} 未回收`,
          subject: foreshadowId,
          location: `第 ${chapterIndex + 1} 章`,
          source: 'foreshadowing' as const,
          retryStrategy: 'draft' as const,
        })),
      ]
    }
  }

  const blockingErrors = updatedPendingIssues.filter((i) => i.severity === 'error')
  if (blockingErrors.length > 0) {
    logger.error(
      `[MuseFlow] 第 ${chapterIndex + 1} 章定稿失败：存在 ${blockingErrors.length} 个严重问题，无法进入下一章。`
    )
    const failureReport = buildChapterReport(
      {
        ...state,
        storyMemory: updatedStoryMemory,
        foreshadowStack: updatedForeshadowStack,
        pendingIssues: updatedPendingIssues,
      },
      updatedChapter ?? existingChapter ?? null,
      chapterContent,
      state.storyState,
      updatedPendingIssues,
      foreshadowsNeedingAttention
    )
    if (boundaryProposals.length > 0) {
      failureReport.actBoundaryProposals = boundaryProposals
    }
    return {
      pendingIssues: updatedPendingIssues,
      rewriteRequested: true,
      chapterReport: failureReport,
    }
  }

  if (updatedStoryArc && updatedStoryArc.totalChapters > updatedTotalChapters) {
    updatedTotalChapters = updatedStoryArc.totalChapters
    updatedStory = {
      ...updatedStory,
      totalChapters: updatedTotalChapters,
      updatedAt: Date.now(),
    }
    updatedOutline = ensureOutlineLength(updatedOutline, updatedTotalChapters)
    updatedChapters = ensureChaptersLength(updatedChapters, updatedTotalChapters)
  }

  updatedVerifiedConstraints = filterVerifiedConstraintsForChapter(
    updatedVerifiedConstraints,
    updatedStoryArc,
    nextIndex
  )

  const reportState: ReducedGraphState = {
    ...stateForActProgress,
    story: updatedStory,
    totalChapters: updatedTotalChapters,
    outline: updatedOutline,
    chapters: updatedChapters,
    storyState: updatedStoryState,
    storyMemory: updatedStoryMemory,
    foreshadowStack: updatedForeshadowStack,
    verifiedConstraints: updatedVerifiedConstraints,
    actProgress: updatedActProgress,
    storyArc: updatedStoryArc ?? null,
    pendingIssues: updatedPendingIssues,
  }

  const chapterReport = buildChapterReport(
    reportState,
    updatedChapter,
    chapterContent,
    updatedStoryState,
    updatedPendingIssues,
    foreshadowsNeedingAttention
  )
  if (boundaryProposals.length > 0) {
    chapterReport.actBoundaryProposals = boundaryProposals
  }

  return {
    story: updatedStory,
    totalChapters: updatedTotalChapters,
    currentChapterIndex: nextIndex,
    chapters: updatedChapters,
    storyState: updatedStoryState,
    storyMemory: updatedStoryMemory,
    foreshadowStack: updatedForeshadowStack,
    verifiedConstraints: updatedVerifiedConstraints,
    actProgress: updatedActProgress,
    chapterReport,
    timeline: updatedTimeline,
    pendingIssues: updatedPendingIssues,
    outline: updatedOutline,
    storyArc: updatedStoryArc,
    canonicalFactsDelta: undefined,
    supersededFactsDelta: undefined,
    ...(updatedForeshadowEquivalenceAudit !== undefined
      ? { foreshadowEquivalenceAudit: updatedForeshadowEquivalenceAudit }
      : {}),
  }
}

function buildChapterReport(
  state: ReducedGraphState,
  chapter: ReducedGraphState['chapters'][number],
  chapterContent: string,
  updatedStoryState: ReducedGraphState['storyState'],
  pendingIssues: Issue[] = state.pendingIssues,
  foreshadowsNeedingAttention: string[] = []
): ChapterReport {
  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]

  const report = createEmptyChapterReport(state.story.id, chapterIndex)
  report.chapterTitle = outlineItem?.title ?? chapter?.title ?? ''
  report.wordCount = countChineseWords(chapterContent)
  report.summary = chapter?.summary ?? null

  const session = state.session
  report.draftStrategy = inferDraftStrategy(state)
  report.rewriteAttempts = session?.rewriteAttempts ?? 0
  report.errorRewriteAttempts = session?.errorRewriteAttempts ?? 0
  report.autoFixAttempts = session?.autoFixAttempts ?? 0

  report.issues = pendingIssues
  report.issuesSummary = summarizeIssues(pendingIssues)

  report.stateCorrections = buildStateCorrections(updatedStoryState)

  report.foreshadowsPlanted = state.foreshadowStack.filter(
    (f) => f.createdAtChapter === chapterIndex + 1
  ).length
  report.foreshadowsFulfilled = state.foreshadowStack.filter(
    (f) => f.fulfilledChapter === chapterIndex + 1
  ).length
  report.foreshadowsOverdue = classifyForeshadows(
    state.foreshadowStack,
    chapterIndex + 1
  ).overdueRequired.length
  if (foreshadowsNeedingAttention.length > 0) {
    report.foreshadowsNeedingAttention = foreshadowsNeedingAttention
  }

  report.convergence = inferConvergence(state)

  const act = getActForChapter(state.storyArc, chapterIndex)
  if (act) {
    const progress = state.actProgress[act.index] ?? {
      consumed: [],
      pending: [...act.mandatoryBeats],
    }
    report.actProgress = {
      actIndex: act.index,
      chaptersRemaining: act.endChapter - (chapterIndex + 1),
      beatsTotal: act.mandatoryBeats.length,
      beatsConsumed: progress.consumed.length,
      beatsPending: progress.pending,
    }
  }

  return report
}

function inferDraftStrategy(state: ReducedGraphState): ChapterReport['draftStrategy'] {
  const session = state.session
  if (session?.routingDecision === 'fix_chapter') return 'fix'
  if (session?.routingDecision === 'finalize_chapter' && (session?.rewriteAttempts ?? 0) === 0) {
    return 'finalize-only'
  }
  if ((session?.autoFixAttempts ?? 0) > 0) return 'fix'
  return 'draft'
}

function inferConvergence(state: ReducedGraphState): ChapterReport['convergence'] {
  const session = state.session
  if (!state.rewriteRequested) return 'success'
  if ((session?.errorRewriteAttempts ?? 0) >= 3) return 'max-attempts-reached'
  return 'manual-rewrite-requested'
}

function buildStateCorrections(storyState: ReducedGraphState['storyState']): StateCorrection[] {
  if (!storyState) return []
  const corrections: StateCorrection[] = []
  for (const fact of storyState.canonicalFacts ?? []) {
    for (const old of fact.supersedes ?? []) {
      corrections.push({
        subject: fact.subject,
        attribute: fact.attribute,
        oldValue: old.oldValue,
        newValue: fact.value,
        reason: 'canonical_fact',
      })
    }
  }
  for (const fact of storyState.supersededFacts ?? []) {
    corrections.push({
      subject: fact.subject,
      attribute: 'fact',
      oldValue: fact.oldFact,
      newValue: '',
      reason: 'superseded_fact',
    })
  }
  return corrections
}
