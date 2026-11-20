import { logger } from '../../../utils/logger.js'
import type { ReducedGraphState } from '../../state.js'
import {
  applyEvents,
  backfillLifecycleProjection,
  createEmptyStoryMemory,
  ensureBeatsHaveActIndex,
  projectStoryStateFromMemory,
} from '../../../story-memory/projector.js'
import type { ForeshadowMergeEvent, StoryEvent } from '../../../types/story-memory.js'
import { readChapterContentForRun } from '../../../storage/filesystem/writer.js'
import {
  getBoundaryBlockingForeshadows,
  partitionInvalidForeshadowIntroductions,
  projectForeshadowStack,
} from '../../../story-memory/foreshadow-policy.js'
import { generateId } from '../../../utils/id.js'
import { agePendingTasks } from '../../../utils/pending-tasks.js'
import type { StoryArc } from '../../../types/outline.js'
import type { Issue } from '../../../types/agent.js'
import {
  buildClosingPhaseConstraint,
  proposeActBoundaryAdjustments,
  applyActBoundaryAdjustment,
  formatActBoundaryAdjustmentCommand,
  getVerifiedBeatsFromMemory,
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
import { harvestChapterCanonicalFacts } from './fact-harvest.js'
import {
  getActForChapter,
  pruneResolvedOutlineCoverageIssues,
  updateActProgress,
} from './act-progress.js'
import {
  getMandatoryBeatEntries,
  getMandatoryBeatEntriesForAct,
} from '../../../utils/mandatory-beat-ids.js'
import { reconcileForeshadowEquivalence } from '../foreshadow-equivalence/reconcile.js'
import { ForeshadowEquivalenceError } from '../foreshadow-equivalence/detector.js'
import {
  evaluateStoryCompletion,
  getUnprovenRequiredKeyBeatIdsThroughAct,
} from '../../../core/story-completion.js'
import { evaluateChapterIncrement } from '../../../story-memory/increment.js'
import { auditChapterBeatCorroboration } from '../../../story-memory/beat-corroboration.js'
import {
  buildActBoundaryPendingIssue,
  buildRequiredBeatCompletionIssues,
  deriveVerifiedBeatsFromPlotAdvanceEvents,
  deriveVerifiedMandatoryBeatIdsFromPlotAdvanceEvents,
  ensureChaptersLength,
  ensureOutlineLength,
  filterStoryEventsForEvidence,
  filterStoryEventsForStoryArc,
  updateOutlineVerifiedBeats,
} from './chapter-events.js'
import { buildChapterReport } from './chapter-report.js'
import { extractChapterSummary } from './chapter-summary.js'

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
  let updatedStoryMemory = backfillLifecycleProjection(
    ensureBeatsHaveActIndex(state.storyMemory ?? createEmptyStoryMemory(), state.storyArc)
  )
  const invalidForeshadowDeadlineEvents: Array<
    Extract<StoryEvent, { type: 'foreshadow-introduce' }>
  > = []
  // B.4 结构化故事时间校验产出的问题（单调性/年号一致性），在定稿问题汇总前并入。
  const storyTimeIssues: Issue[] = []
  const newForeshadowIntroduceEvents: Array<Extract<StoryEvent, { type: 'foreshadow-introduce' }>> =
    []
  let updatedForeshadowEquivalenceAudit: ReducedGraphState['foreshadowEquivalenceAudit']
  let pendingForeshadowEquivalenceLog:
    | {
        mergeEvents: ForeshadowMergeEvent[]
        activeCanonicalCountBeforeMerge: number
        activeCanonicalCountAfterMerge: number
      }
    | undefined

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
          pendingForeshadowEquivalenceLog = {
            mergeEvents: reconciled.mergeEvents,
            activeCanonicalCountBeforeMerge: reconciled.activeCanonicalCountBeforeMerge,
            activeCanonicalCountAfterMerge: reconciled.audit.activeCanonicalIds.length,
          }
        }
      } catch (error) {
        if (!(error instanceof ForeshadowEquivalenceError)) throw error
        return {
          pendingIssues: [
            ...state.pendingIssues,
            {
              id: `foreshadow-equivalence-failed-${chapterIndex}-${generateId()}`,
              ruleId: 'foreshadow.equivalence',
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

  const summaryResult = await extractChapterSummary({
    state,
    provider,
    chapterContent,
    chapter: updatedChapter,
    chapters: updatedChapters,
    outline: updatedOutline,
    storyMemory: updatedStoryMemory,
    storyState: updatedStoryState,
    draftPlotAdvanceBeatIds,
  })
  updatedChapter = summaryResult.chapter
  updatedChapters = summaryResult.chapters
  updatedOutline = summaryResult.outline
  updatedStoryMemory = summaryResult.storyMemory
  updatedStoryState = summaryResult.storyState
  newForeshadowIntroduceEvents.push(...summaryResult.newForeshadowIntroduceEvents)
  invalidForeshadowDeadlineEvents.push(...summaryResult.invalidForeshadowDeadlineEvents)
  storyTimeIssues.push(...summaryResult.storyTimeIssues)
  if (summaryResult.failureIssue) {
    return { pendingIssues: [...state.pendingIssues, summaryResult.failureIssue] }
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

  // D.2.1/D.2.3 mandatory beat 消费佐证审计：对本章新获证明的 mandatory beat
  // 评估结构化佐证（绑定的同章状态类事件 / 受佐证的章末终态声明），审计记录随
  // memory 持久化；未佐证的 beat 在幕进度（下方 updateActProgress）中保持 pending。
  updatedStoryMemory = auditChapterBeatCorroboration(
    updatedStoryMemory,
    state.storyArc,
    chapterIndex,
    state.chapterFinalStateDeclarations ?? []
  )

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

  // B.2 事实回采：从本章已接受事件流与受佐证的章末终态声明派生 canonicalFacts
  // （source 'chapter_text'）。mergeStoryState 对同 subject+attribute+value 幂等替换，
  // 对同 subject+attribute 新值退休旧值，因此重写/重复定稿不会产生重复事实。
  const harvestedFacts = harvestChapterCanonicalFacts({
    chapterIndex,
    acceptedEvents: draftEvents,
    finalStateDeclarations: state.chapterFinalStateDeclarations ?? [],
  })
  if (harvestedFacts.length > 0) {
    updatedStoryState = mergeStoryState(updatedStoryState ?? null, {
      ...createEmptyStoryState(),
      canonicalFacts: harvestedFacts,
    })
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
    storyArc: state.storyArc,
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
  } = await updateActProgress(
    stateForActProgress,
    chapterIndex,
    planningConfig.actClosingPhaseRatio
  )
  if (beatPressureConstraint) {
    updatedVerifiedConstraints = [...updatedVerifiedConstraints, beatPressureConstraint]
  }

  const closingPhaseConstraint = state.storyArc
    ? buildClosingPhaseConstraint(
        state.storyArc,
        updatedActProgress,
        chapterIndex,
        planningConfig.bookClosingPhaseRatio,
        new Set(
          updatedStoryMemory ? getVerifiedBeatsFromMemory(updatedStoryMemory, state.storyArc) : []
        )
      )
    : undefined
  if (closingPhaseConstraint) {
    updatedVerifiedConstraints = [
      ...updatedVerifiedConstraints,
      createGenericVerifiedConstraint(closingPhaseConstraint),
    ]
  }

  // Replace previous verification results for the same structured rule/subject pair.
  const newIssueKeys = new Set(
    beatVerificationIssues?.map((issue) => `${issue.ruleId}\u0000${issue.subject ?? ''}`) ?? []
  )
  let updatedPendingIssues = state.pendingIssues.filter(
    (issue) => !newIssueKeys.has(`${issue.ruleId}\u0000${issue.subject ?? ''}`)
  )
  if (beatVerificationIssues && beatVerificationIssues.length > 0) {
    updatedPendingIssues = [...updatedPendingIssues, ...beatVerificationIssues]
  }
  if (invalidForeshadowDeadlineEvents.length > 0) {
    updatedPendingIssues = [
      ...updatedPendingIssues,
      ...invalidForeshadowDeadlineEvents.map((event) => ({
        id: `invalid-foreshadow-deadline-${event.id}`,
        ruleId: 'structured.foreshadow-invalid-deadline',
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
  if (storyTimeIssues.length > 0) {
    updatedPendingIssues = [...updatedPendingIssues, ...storyTimeIssues]
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
        ruleId: 'foreshadow.final-act-introduction',
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
    chapterIndex,
    updatedStoryMemory
  )
  const actBoundarySubjects = new Set((state.storyArc?.acts ?? []).map((act) => `act-${act.index}`))
  updatedPendingIssues = updatedPendingIssues.filter(
    (issue) =>
      issue.ruleId !== 'outline-coverage.pending-beats-at-boundary' ||
      !issue.subject ||
      !actBoundarySubjects.has(issue.subject)
  )

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
            chapterIndex,
            planningConfig
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
                  ruleId: 'outline-coverage.auto-extension-limit',
                  type: 'outline_coverage',
                  severity: 'error',
                  subject: `act-${proposal.actIndex}`,
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

  if (updatedStoryArc && updatedStoryArc.totalChapters !== updatedTotalChapters) {
    updatedTotalChapters = updatedStoryArc.totalChapters
    updatedStory = {
      ...updatedStory,
      totalChapters: updatedTotalChapters,
      updatedAt: Date.now(),
    }
    updatedOutline = ensureOutlineLength(updatedOutline, updatedTotalChapters)
    updatedChapters = ensureChaptersLength(updatedChapters, updatedTotalChapters)
  }

  const finalizedAct = getActForChapter(updatedStoryArc, chapterIndex)
  if (finalizedAct && chapterIndex + 1 >= finalizedAct.endChapter) {
    const finalizedProgress = updatedActProgress[finalizedAct.index] ?? {
      consumed: [],
      pending: [...finalizedAct.mandatoryBeats],
    }
    if (finalizedProgress.pending.length > 0) {
      // D.2.2 幕关闭质量复审：proven 但未佐证的 mandatory beat 已被消费闸留在
      // pending 中，此处单独点名，供作者判断是重写补佐证还是人工强制关闭。
      const uncorroboratedBeatIds = getMandatoryBeatEntriesForAct(finalizedAct)
        .filter(
          (entry) =>
            updatedStoryMemory?.beats[entry.id]?.corroboration?.status === 'proven_uncorroborated'
        )
        .map((entry) => entry.id)
      updatedPendingIssues = [
        ...updatedPendingIssues,
        buildActBoundaryPendingIssue(
          state.story.id,
          finalizedAct,
          finalizedProgress.pending,
          uncorroboratedBeatIds
        ),
      ]
    }
    if (updatedStoryArc && updatedStoryMemory) {
      const unprovenKeyBeatIssues = buildRequiredBeatCompletionIssues(
        getUnprovenRequiredKeyBeatIdsThroughAct(
          updatedStoryArc,
          updatedStoryMemory,
          finalizedAct.index
        ),
        chapterIndex,
        updatedPendingIssues
      )
      if (unprovenKeyBeatIssues.length > 0) {
        updatedPendingIssues = [...updatedPendingIssues, ...unprovenKeyBeatIssues]
      }
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
          ruleId: 'foreshadow.boundary',
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

  if (isStoryEnd) {
    const completionAudit = evaluateStoryCompletion({
      currentChapterIndex: nextIndex,
      totalChapters: updatedTotalChapters,
      storyArc: updatedStoryArc,
      storyMemory: updatedStoryMemory,
      pendingIssues: updatedPendingIssues,
    })
    const unprovenBeatIssues = buildRequiredBeatCompletionIssues(
      completionAudit.unprovenBeatIds,
      chapterIndex,
      updatedPendingIssues
    )
    if (unprovenBeatIssues.length > 0) {
      updatedPendingIssues = [...updatedPendingIssues, ...unprovenBeatIssues]
    }
    const existingStructuralBlockers = new Set(
      updatedPendingIssues
        .filter((issue) => issue.ruleId === 'story-completion.structural-blocker')
        .flatMap((issue) => (issue.subject ? [issue.subject] : []))
    )
    const structuralIssues = completionAudit.structuralBlockerCodes
      .filter((code) => !existingStructuralBlockers.has(code))
      .map((code) => ({
        id: `story-completion-structural-${code}-${chapterIndex}`,
        ruleId: 'story-completion.structural-blocker',
        type: 'state_corruption' as const,
        severity: 'error' as const,
        description: `全书已到规划边界，但完结审计缺少结构化权威数据：${code}。`,
        subject: code,
        location: `第 ${chapterIndex + 1} 章`,
        source: 'state_reconciliation' as const,
        retryStrategy: 'manual' as const,
      }))
    if (structuralIssues.length > 0) {
      updatedPendingIssues = [...updatedPendingIssues, ...structuralIssues]
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

  if (pendingForeshadowEquivalenceLog) {
    for (const event of pendingForeshadowEquivalenceLog.mergeEvents) {
      logger.info(
        `[MuseFlow] 伏笔等价合并 ${event.duplicateForeshadowId} -> ${event.canonicalForeshadowId}`
      )
    }
    logger.info(
      `[MuseFlow] 伏笔等价审计：活跃规范义务 ${pendingForeshadowEquivalenceLog.activeCanonicalCountBeforeMerge} -> ${pendingForeshadowEquivalenceLog.activeCanonicalCountAfterMerge}`
    )
  }

  // 章节密度计数器（C.2.2/C.2.3）：随定稿提交并随 checkpoint 持久化。
  // 零增量连击：本章定稿后 memory 无任何增量 +1，有增量清零；
  // 零认领连击：本章大纲零认领且当前幕仍有待消费 mandatory beat +1，否则清零。
  let nextConsecutiveZeroIncrementChapters = state.consecutiveZeroIncrementChapters ?? 0
  if (hasInputStoryMemory && state.storyMemory) {
    const beforeEventIds = new Set(state.storyMemory.events.map((event) => event.id))
    const chapterDeltaEvents = updatedStoryMemory.events.filter(
      (event) => event.chapterIndex === chapterIndex && !beforeEventIds.has(event.id)
    )
    const incrementVerdict = evaluateChapterIncrement(
      chapterIndex,
      state.storyMemory,
      updatedStoryMemory,
      chapterDeltaEvents
    )
    if (incrementVerdict.zeroIncrement) {
      nextConsecutiveZeroIncrementChapters += 1
      logger.warn(
        `[MuseFlow] 第 ${chapterIndex + 1} 章为连续第 ${nextConsecutiveZeroIncrementChapters} 个零增量章（角色位置/状态、物品、伏笔、任务、节拍推进均无变化）`
      )
    } else {
      nextConsecutiveZeroIncrementChapters = 0
    }
  }
  const finalizedClaimedMandatoryBeatIds =
    updatedOutline[chapterIndex]?.claimedMandatoryBeatIds ?? []
  const verifiedBeatIdsAfterFinalize = new Set(
    getVerifiedBeatsFromMemory(updatedStoryMemory, updatedStoryArc ?? state.storyArc)
  )
  const pendingMandatoryBeatsInAct = finalizedAct
    ? getMandatoryBeatEntries(updatedStoryArc ?? state.storyArc).filter(
        (entry) =>
          entry.actIndex === finalizedAct.index && !verifiedBeatIdsAfterFinalize.has(entry.id)
      )
    : []
  const nextConsecutiveZeroClaimChapters =
    finalizedClaimedMandatoryBeatIds.length === 0 && pendingMandatoryBeatsInAct.length > 0
      ? (state.consecutiveZeroClaimChapters ?? 0) + 1
      : 0
  if (nextConsecutiveZeroClaimChapters > 0) {
    logger.warn(
      `[MuseFlow] 第 ${chapterIndex + 1} 章为连续第 ${nextConsecutiveZeroClaimChapters} 个零认领章（当前幕仍有 ${pendingMandatoryBeatsInAct.length} 个待消费 mandatory beat）`
    )
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
    consecutiveZeroIncrementChapters: nextConsecutiveZeroIncrementChapters,
    consecutiveZeroClaimChapters: nextConsecutiveZeroClaimChapters,
    ...(updatedForeshadowEquivalenceAudit !== undefined
      ? { foreshadowEquivalenceAudit: updatedForeshadowEquivalenceAudit }
      : {}),
  }
}
