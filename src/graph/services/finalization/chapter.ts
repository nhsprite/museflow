import { logger } from '../../../utils/logger.js'
import type { ReducedGraphState } from '../../state.js'
import type { SummaryAgentInput } from '../../../agents/types.js'
import { getSummaryAgent } from '../../agent-factory.js'
import {
  applyEvents,
  createEmptyStoryMemory,
  ensureBeatsHaveActIndex,
} from '../../../story-memory/projector.js'
import {
  getActiveForeshadows,
  getOpenTasks,
  getUnprovenMandatoryBeats,
} from '../../../story-memory/queries.js'
import type {
  StoryEvent,
  StoryMemory,
  ForeshadowId,
  TaskId,
  BeatId,
} from '../../../types/story-memory.js'
import type { ForeshadowItem } from '../../../types/foreshadow.js'
import { readChapterContent } from '../../../storage/filesystem/writer.js'
import { saveChapterReport } from '../../../storage/meta/stores/chapter-report.js'
import { getForeshadowAlerts } from '../../../types/foreshadow.js'
import { generateId } from '../../../utils/id.js'
import { createCheckpointService } from '../../../storage/checkpoint-service.js'
import { agePendingTasks } from '../../../utils/pending-tasks.js'
import { buildEffectiveCharactersList } from '../../utils/characters.js'
import { generateForeshadowConstraints } from '../../../utils/foreshadow-constraints.js'
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
  judgeMandatoryBeatCoverage,
} from '../../../utils/story-arc.js'
import { getChapterPlanningConfig } from '../../../utils/chapter-planning.js'
import { loadConfig } from '../../../config/store.js'
import { writeOutlineContent } from '../../../storage/filesystem/writer.js'
import {
  createGenericVerifiedConstraint,
  filterVerifiedConstraintsForChapter,
  normalizeVerifiedConstraints,
} from '../../../utils/verified-constraints.js'
import {
  getActForChapter,
  getPendingMandatoryBeats,
  normalizeVerifiedBeats,
  pruneResolvedOutlineCoverageIssues,
  updateActProgress,
} from './act-progress.js'

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
    .map((e) => beatIdToText.get(e.beatId))
    .filter((b): b is string => !!b)
}

function updateOutlineVerifiedBeats(
  outline: ReducedGraphState['outline'],
  chapterIndex: number,
  verifiedBeats: string[]
): ReducedGraphState['outline'] {
  const currentOutline = outline[chapterIndex]
  if (!currentOutline || verifiedBeats.length === 0) return outline
  const merged = Array.from(new Set([...(currentOutline.verifiedBeats ?? []), ...verifiedBeats]))
  const next = [...outline]
  next[chapterIndex] = { ...currentOutline, verifiedBeats: merged }
  return next
}

function filterStoryEventsForStoryArc(
  events: StoryEvent[],
  storyArc: StoryArc | null | undefined
): StoryEvent[] {
  if (!storyArc || storyArc.keyBeats.length === 0) return events
  const validBeatIds = new Set(storyArc.keyBeats.map((beat) => beat.id))
  return events.filter((event) => event.type !== 'plot-advance' || validBeatIds.has(event.beatId))
}

function getClaimedMandatoryBeatsForCoverage(
  outlineItem: ReducedGraphState['outline'][number] | undefined,
  mandatoryBeats: string[]
): string[] {
  const allowed = new Set(mandatoryBeats)
  const claimed = new Set<string>()
  for (const beat of outlineItem?.claimedBeats ?? []) {
    if (allowed.has(beat)) {
      claimed.add(beat)
    }
  }
  return Array.from(claimed)
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

function isSummaryData(
  data: unknown
): data is { storyEvents?: StoryEvent[]; chapterSummary?: string } {
  return (
    typeof data === 'object' && data !== null && ('storyEvents' in data || 'chapterSummary' in data)
  )
}

function buildVerifiedConstraints(
  memory: StoryMemory,
  activeForeshadows: ForeshadowId[],
  openTasks: TaskId[],
  unprovenBeats: BeatId[]
): string[] {
  const constraints: string[] = []
  for (const id of activeForeshadows) {
    const fs = memory.foreshadows[id]
    if (fs) constraints.push(`未回收伏笔 [${id}]: ${fs.text}`)
  }
  for (const id of openTasks) {
    const task = memory.tasks[id]
    if (task) constraints.push(`未完成任务 [${id}]: ${task.description}`)
  }
  for (const id of unprovenBeats) {
    const beat = memory.beats[id]
    if (beat) constraints.push(`未推进节拍 [${id}]: ${beat.description}`)
  }
  return constraints
}

function foreshadowMemoryToItem(
  memory: import('../../../types/story-memory.js').ForeshadowMemory
): ForeshadowItem {
  const item: ForeshadowItem = {
    id: memory.id,
    text: memory.text,
    expectedFulfillChapter: memory.expectedFulfillChapter ?? Number.MAX_SAFE_INTEGER,
    createdAt: 0,
    createdAtChapter: memory.introducedIn,
    status: memory.fulfilledIn ? 'recalled' : 'planted',
    isExplicit: true,
    required: memory.required,
  }
  if (memory.fulfilledIn) {
    item.fulfilledChapter = memory.fulfilledIn
  }
  if (memory.beatId) {
    item.beatId = memory.beatId
  }
  return item
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
  let updatedChapterSummaries = [...state.chapterSummaries]

  const chapterContent = await readChapterContent(state.story.outputDir, chapterIndex + 1)
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
  let updatedStoryMemory = ensureBeatsHaveActIndex(
    state.storyMemory ?? createEmptyStoryMemory(),
    state.storyArc
  )

  // Authoritative source of events: the writer already emitted them in the
  // STORY_EVENTS block. Apply them before asking SummaryAgent to avoid losing
  // structured plot-advance events and to skip prose-based guessing.
  const draftEvents = filterStoryEventsForStoryArc(state.draftChapterEvents ?? [], state.storyArc)
  const draftPlotAdvanceBeatIds = new Set(
    draftEvents
      .filter((e): e is StoryEvent & { type: 'plot-advance' } => e.type === 'plot-advance')
      .map((e) => e.beatId)
  )
  if (draftEvents.length > 0) {
    updatedStoryMemory = applyEvents(updatedStoryMemory ?? createEmptyStoryMemory(), draftEvents)
    const draftVerifiedBeats = deriveVerifiedBeatsFromPlotAdvanceEvents(draftEvents, state.storyArc)
    if (draftVerifiedBeats.length > 0) {
      updatedOutline = updateOutlineVerifiedBeats(updatedOutline, chapterIndex, draftVerifiedBeats)
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
      const summaryState: SummaryAgentInput = {
        idea: state.idea,
        genre: state.genre,
        totalChapters: state.totalChapters,
        chapterContent,
        charactersList: effectiveCharacters,
        outlineCharacters,
        establishedCharacters,
        ...(currentOutline?.title ? { chapterTitle: currentOutline.title } : {}),
        chapterIndex,
        ...(beatsToVerify.length > 0 ? { claimedBeats: beatsToVerify } : {}),
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

          // SummaryAgent events are a fallback for events the writer missed.
          // For plot-advance, draft events are authoritative; skip duplicates.
          const actualEvents = filterStoryEventsForStoryArc(
            summaryData.storyEvents ?? [],
            state.storyArc
          )
          const newEvents = actualEvents.filter((event) => {
            if (event.type === 'plot-advance') {
              return !draftPlotAdvanceBeatIds.has(event.beatId)
            }
            return true
          })
          if (newEvents.length > 0) {
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
          if (summaryVerifiedBeats.length > 0) {
            updatedOutline = updateOutlineVerifiedBeats(
              updatedOutline,
              chapterIndex,
              summaryVerifiedBeats
            )
          }

          // Only fall back to prose-based judgment for beats that are still
          // missing after structured events. This keeps the critical path on
          // explicit event IDs.
          const actForCoverage = getActForChapter(state.storyArc, chapterIndex)
          const latestCurrentOutline = updatedOutline[chapterIndex] ?? currentOutline
          if (actForCoverage && latestCurrentOutline && chapterContent) {
            const allVerified = normalizeVerifiedBeats(
              latestCurrentOutline.verifiedBeats ?? [],
              actForCoverage.mandatoryBeats
            )
            const coverageCandidates = getClaimedMandatoryBeatsForCoverage(
              latestCurrentOutline,
              actForCoverage.mandatoryBeats
            )
            const missingAfterEvents = coverageCandidates.filter(
              (beat) => !allVerified.includes(beat)
            )
            if (missingAfterEvents.length > 0) {
              const contentVerified = await judgeMandatoryBeatCoverage(
                provider,
                chapterContent,
                missingAfterEvents
              )
              const merged = Array.from(new Set([...allVerified, ...contentVerified]))
              if (merged.length > allVerified.length) {
                const newOutline = [...updatedOutline]
                const latestOutline = newOutline[chapterIndex] ?? latestCurrentOutline
                newOutline[chapterIndex] = { ...latestOutline, verifiedBeats: merged }
                updatedOutline = newOutline
                logger.debug(
                  `[MuseFlow] 第 ${chapterIndex + 1} 章通过正文覆盖判定补充 ${merged.length - allVerified.length} 个 beats`
                )
              }
            }
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

    if (summary && !updatedChapterSummaries.includes(summary)) {
      updatedChapterSummaries = [...updatedChapterSummaries, summary]
    }
  }

  let updatedForeshadowStack = state.foreshadowStack
  let memoryConstraintTexts: string[] = []
  if (updatedStoryMemory) {
    const memoryForeshadows = Object.values(updatedStoryMemory.foreshadows)
    updatedForeshadowStack =
      memoryForeshadows.length > 0
        ? memoryForeshadows.map(foreshadowMemoryToItem)
        : state.foreshadowStack
    const activeForeshadows = getActiveForeshadows(updatedStoryMemory)
    const openTasks = getOpenTasks(updatedStoryMemory)
    const unprovenBeats = getUnprovenMandatoryBeats(updatedStoryMemory)
    memoryConstraintTexts = buildVerifiedConstraints(
      updatedStoryMemory,
      activeForeshadows,
      openTasks,
      unprovenBeats
    )
    if (memoryConstraintTexts.length > 0) {
      logger.info(
        `[MuseFlow] 第 ${chapterIndex + 1} 章生成 ${memoryConstraintTexts.length} 条 StoryMemory 约束`
      )
    }
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

  const newForeshadowConstraints = generateForeshadowConstraints(
    updatedForeshadowStack,
    chapterIndex + 1
  )
  let updatedVerifiedConstraints =
    memoryConstraintTexts.length > 0
      ? memoryConstraintTexts.map(createGenericVerifiedConstraint)
      : normalizeVerifiedConstraints(state.verifiedConstraints)
  if (newForeshadowConstraints.length > 0) {
    updatedVerifiedConstraints = [
      ...updatedVerifiedConstraints,
      ...newForeshadowConstraints.map(createGenericVerifiedConstraint),
    ]
  }

  const stateForActProgress: ReducedGraphState = {
    ...state,
    outline: updatedOutline,
    chapters: updatedChapters,
    chapterSummaries: updatedChapterSummaries,
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

  const planningConfig = getChapterPlanningConfig(state.genre)
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
      chapterIndex
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

  const blockingErrors = updatedPendingIssues.filter((i) => i.severity === 'error')
  if (blockingErrors.length > 0) {
    logger.error(
      `[MuseFlow] 第 ${chapterIndex + 1} 章定稿失败：存在 ${blockingErrors.length} 个严重问题，无法进入下一章。`
    )
    const failureReport = buildChapterReport(
      { ...state, pendingIssues: updatedPendingIssues },
      updatedChapter ?? existingChapter ?? null,
      chapterContent,
      state.storyState,
      updatedPendingIssues
    )
    if (boundaryProposals.length > 0) {
      failureReport.actBoundaryProposals = boundaryProposals
    }
    saveChapterReport(state.story.outputDir, failureReport)
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
    chapterSummaries: updatedChapterSummaries,
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
    updatedPendingIssues
  )
  if (boundaryProposals.length > 0) {
    chapterReport.actBoundaryProposals = boundaryProposals
  }

  if (updatedStoryArc && updatedStoryArc !== state.storyArc) {
    await writeOutlineContent(
      state.story.outputDir,
      state.story.title,
      updatedOutline,
      updatedStoryArc
    )
  }

  saveChapterReport(state.story.outputDir, chapterReport)

  const checkpointService = createCheckpointService(state.story.outputDir)
  await checkpointService.pruneIntermediateCheckpoints().catch(() => {})
  await checkpointService.clearPendingWrites().catch(() => {})

  return {
    story: updatedStory,
    totalChapters: updatedTotalChapters,
    currentChapterIndex: nextIndex,
    chapters: updatedChapters,
    chapterSummaries: updatedChapterSummaries,
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
  }
}

function buildChapterReport(
  state: ReducedGraphState,
  chapter: ReducedGraphState['chapters'][number],
  chapterContent: string,
  updatedStoryState: ReducedGraphState['storyState'],
  pendingIssues: Issue[] = state.pendingIssues
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

  const alerts = getForeshadowAlerts(state.foreshadowStack, chapterIndex + 1)
  report.foreshadowsPlanted = state.foreshadowStack.filter(
    (f) => f.createdAtChapter === chapterIndex + 1
  ).length
  report.foreshadowsFulfilled = state.foreshadowStack.filter(
    (f) => f.fulfilledChapter === chapterIndex + 1
  ).length
  report.foreshadowsOverdue = alerts.filter((a) => a.level === 'overdue').length

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
