import { logger } from '../../../utils/logger.js'
import type { ReducedGraphState } from '../../state.js'
import type { SummaryAgentInput } from '../../../agents/types.js'
import { getSummaryAgent } from '../../agent-factory.js'
import { processSummaryOutput } from '../../../agents/index.js'
import { readChapterContent } from '../../../storage/filesystem/writer.js'
import { saveChapterReport } from '../../../storage/meta/stores/chapter-report.js'
import { getForeshadowAlerts } from '../../../types/foreshadow.js'
import { generateId } from '../../../utils/id.js'
import { createCheckpointService } from '../../../storage/checkpoint-service.js'
import { agePendingTasks } from '../../../utils/pending-tasks.js'
import { mergeStoryState } from '../../utils/reconciler/index.js'
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
import { buildClosingPhaseConstraint, proposeActBoundaryAdjustments } from '../../../utils/story-arc.js'
import { getChapterPlanningConfig } from '../../../utils/chapter-planning.js'

export async function finalizeChapter(
  state: ReducedGraphState,
  provider: import('../../../model/provider.js').ModelProvider
): Promise<Partial<ReducedGraphState>> {
  const chapterIndex = state.currentChapterIndex
  const chapter = state.chapters[chapterIndex]

  const chapterContent = await readChapterContent(state.story.outputDir, chapterIndex + 1)
  if (chapterContent === null || chapterContent.trim().length === 0) {
    throw new Error(
      `第 ${chapterIndex + 1} 章文件为空或不存在，无法标记为完成。请重试撰写。`
    )
  }

  const pendingErrors = state.pendingIssues.filter(i => i.severity === 'error')
  if (pendingErrors.length > 0) {
    logger.warn(
      `[MuseFlow] 第 ${chapterIndex + 1} 章存在 ${pendingErrors.length} 个未解决的严重问题，跳过 finalize，避免未验证内容进入 storyState。`
    )
    return {}
  }

  let updatedStoryState = state.storyState

  if (chapter) {
    let summary = chapter.summary || ''
    const needsSummary = !summary && chapterContent
    if (needsSummary) {
      const summaryAgent = getSummaryAgent(provider)
      const { merged: effectiveCharacters, outline: outlineCharacters, established: establishedCharacters } = buildEffectiveCharactersList(state, chapterIndex)
      const currentOutline = state.outline[chapterIndex]
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
        ...(currentOutline?.claimedBeats && currentOutline.claimedBeats.length > 0
          ? { claimedBeats: currentOutline.claimedBeats }
          : {}),
      }

      const MAX_SUMMARY_RETRIES = 2
      let summarySuccess = false
      for (let attempt = 0; attempt <= MAX_SUMMARY_RETRIES; attempt++) {
        if (attempt > 0) {
          logger.info(`[MuseFlow] 第 ${chapterIndex + 1} 章摘要生成失败，第 ${attempt}/${MAX_SUMMARY_RETRIES} 次重试...`)
        }
        try {
          const summaryOutput = await summaryAgent.run(summaryState)
          if (!summaryOutput.success) {
            logger.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章摘要 agent 返回失败: ${summaryOutput.error || '未知错误'}`)
            continue
          }
          const processed = processSummaryOutput(summaryOutput, chapterIndex, effectiveCharacters, state.storyState)
          if (!processed || !processed.summary) {
            logger.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章摘要处理结果为空`)
            continue
          }
          summary = processed.summary
          chapter.summary = summary
          summarySuccess = true

          if (processed.verifiedBeats && currentOutline) {
            const newOutline = [...state.outline]
            newOutline[chapterIndex] = { ...currentOutline, verifiedBeats: processed.verifiedBeats }
            state.outline = newOutline
          }

          if (processed.storyState) {
            updatedStoryState = mergeStoryState(state.storyState, processed.storyState)
            logger.info(`[MuseFlow] 第 ${chapterIndex + 1} 章状态已更新：${updatedStoryState.currentScene || '无场景'} | ${updatedStoryState.storyTime || '无时间标记'}`)
          }
          break
        } catch (err) {
          logger.warn(`[MuseFlow] 生成第 ${chapterIndex + 1} 章摘要失败 (attempt ${attempt + 1}/${MAX_SUMMARY_RETRIES + 1}):`, err)
        }
      }

      if (!summarySuccess) {
        logger.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章摘要生成最终失败，将在无摘要状态下标记本章完成。后续一致性检查可能受影响。`)
      }
    }

    if (summary && !state.chapterSummaries.includes(summary)) {
      state.chapterSummaries.push(summary)
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
    chapterTitle: state.outline[chapterIndex]?.title ?? null,
    chapterSummary: chapter?.summary ?? null,
    wordCount: null,
    stateSummary: null,
    issuesResolved: state.pendingIssues.filter(i => i.severity !== 'error').length,
    issuesPending: state.pendingIssues.filter(i => i.severity === 'error').length,
    stateJson: null,
    createdAt: Date.now(),
  }
  const updatedTimeline = [...(state.timeline ?? []), snapshot]

  const newForeshadowConstraints = generateForeshadowConstraints(state.foreshadowStack, chapterIndex + 1)
  let updatedVerifiedConstraints = newForeshadowConstraints.length > 0
    ? [...(state.verifiedConstraints ?? []), ...newForeshadowConstraints]
    : (state.verifiedConstraints ?? [])

  const { actProgress: updatedActProgress, beatPressureConstraint, beatVerificationIssues } = updateActProgress(state, chapterIndex)
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
    updatedVerifiedConstraints = [...updatedVerifiedConstraints, closingPhaseConstraint]
  }

  const updatedPendingIssues = beatVerificationIssues && beatVerificationIssues.length > 0
    ? [...state.pendingIssues, ...beatVerificationIssues]
    : state.pendingIssues

  const nextIndex = state.currentChapterIndex + 1

  const chapterReport = buildChapterReport(
    state,
    chapter ?? null,
    chapterContent,
    updatedStoryState,
    updatedPendingIssues
  )

  if (state.storyArc) {
    const boundaryProposals = proposeActBoundaryAdjustments(state.storyArc, updatedActProgress, chapterIndex)
    if (boundaryProposals.length > 0) {
      chapterReport.actBoundaryProposals = boundaryProposals
      logger.warn('[MuseFlow] 检测到幕边界调整建议：')
      for (const proposal of boundaryProposals) {
        logger.warn(`  - 第 ${proposal.actIndex} 幕建议结束于第 ${proposal.proposedEndChapter} 章：${proposal.reason}`)
      }
      logger.warn('  如要采纳，请运行：museflow adjust-act <story-id> --act <index> --end-chapter <number>')
    }
  }

  saveChapterReport(state.story.outputDir, chapterReport)

  const checkpointService = createCheckpointService(state.story.outputDir)
  await checkpointService.pruneIntermediateCheckpoints().catch(() => {})
  await checkpointService.clearPendingWrites().catch(() => {})

  return {
    currentChapterIndex: nextIndex,
    chapterSummaries: state.chapterSummaries,
    storyState: updatedStoryState,
    verifiedConstraints: updatedVerifiedConstraints,
    actProgress: updatedActProgress,
    chapterReport,
    timeline: updatedTimeline,
    pendingIssues: updatedPendingIssues,
    outline: state.outline,
  }
}

function getActForChapter(storyArc: StoryArc | null | undefined, chapterIndex: number): ActArc | undefined {
  if (!storyArc) return undefined
  const chapterNumber = chapterIndex + 1
  return storyArc.acts.find(a => chapterNumber >= a.startChapter && chapterNumber <= a.endChapter)
}

function updateActProgress(
  state: ReducedGraphState,
  chapterIndex: number
): {
  actProgress: ReducedGraphState['actProgress']
  beatPressureConstraint?: string
  beatVerificationIssues?: Issue[]
} {
  const storyArc = state.storyArc
  const act = getActForChapter(storyArc, chapterIndex)
  if (!storyArc || !act) {
    return { actProgress: state.actProgress }
  }

  const currentOutline = state.outline[chapterIndex]
  const claimedBeats = currentOutline?.claimedBeats ?? []
  const verifiedBeats = currentOutline?.verifiedBeats ?? []

  const prevProgress = state.actProgress[act.index] ?? {
    consumed: [],
    pending: [...act.mandatoryBeats],
  }

  // 只采信经 SummaryAgent 验证的 beats；若尚未验证则视为未消费
  const newlyConsumed = verifiedBeats.filter(
    beat => !prevProgress.consumed.includes(beat)
  )
  const consumed = [...prevProgress.consumed, ...newlyConsumed]
  const pending = act.mandatoryBeats.filter(beat => !consumed.includes(beat))

  const updatedActProgress: ReducedGraphState['actProgress'] = {
    ...state.actProgress,
    [act.index]: { consumed, pending },
  }

  const beatVerificationIssues: Issue[] = []
  const unverifiedClaimed = claimedBeats.filter(beat => !verifiedBeats.includes(beat))
  for (const beat of unverifiedClaimed) {
    if (act.mandatoryBeats.includes(beat)) {
      beatVerificationIssues.push({
        id: `unverified-beat-${chapterIndex}-${beat}`,
        type: 'outline_coverage',
        severity: 'warning',
        description: `本章大纲声称推进 mandatory beat「${beat}」，但正文未验证到该 beat 的发生。`,
        suggestion: `请在后续章节中确保该 beat 被明确确立，或调整大纲不再声称推进该 beat。`,
      })
    }
  }

  const chaptersRemaining = act.endChapter - (chapterIndex + 1)
  const totalActChapters = act.endChapter - act.startChapter + 1
  const isInClosingPhase = chaptersRemaining / totalActChapters <= 0.2 && chaptersRemaining >= 0

  if (isInClosingPhase && pending.length > 0) {
    logger.warn(
      `[MuseFlow] 第 ${act.index} 幕进入收尾阶段，仍有 ${pending.length} 个 mandatory beats 未消费：${pending.join('、')}`
    )
    return {
      actProgress: updatedActProgress,
      beatPressureConstraint: `【幕级节拍压力】第 ${act.index} 幕「${act.title}」还剩 ${chaptersRemaining} 章结束，必须优先消费以下 mandatory beats：${pending.join('、')}。本章及后续章节必须将推进这些节拍作为最高优先级，不得再扩展无关支线。`,
      beatVerificationIssues,
    }
  }

  // 检查全局 key beats 是否逾期
  const currentActIndex = act.index
  const overdueKeyBeats = storyArc.keyBeats.filter(
    kb => kb.deadlineAct <= currentActIndex && !consumed.includes(kb.beat) && !verifiedBeats.includes(kb.beat)
  )
  if (overdueKeyBeats.length > 0 && chaptersRemaining === 0) {
    logger.warn(
      `[MuseFlow] 第 ${act.index} 幕结束时有 ${overdueKeyBeats.length} 个全局 key beats 逾期未消费：${overdueKeyBeats.map(k => k.beat).join('、')}`
    )
  }

  return { actProgress: updatedActProgress, beatVerificationIssues }
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
    f => f.createdAtChapter === chapterIndex + 1
  ).length
  report.foreshadowsFulfilled = state.foreshadowStack.filter(
    f => f.fulfilledChapter === chapterIndex + 1
  ).length
  report.foreshadowsOverdue = alerts.filter(a => a.level === 'overdue').length

  report.convergence = inferConvergence(state)

  const act = getActForChapter(state.storyArc, chapterIndex)
  if (act) {
    const progress = state.actProgress[act.index] ?? { consumed: [], pending: [...act.mandatoryBeats] }
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
