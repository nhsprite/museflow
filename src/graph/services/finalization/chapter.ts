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
import { patchChapterSummaryWithFacts } from '../../../utils/summary-patch.js'
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
  judgeMandatoryBeatCoverage,
  judgeMandatoryBeatCoverageAcrossAct,
  matchMandatoryBeat,
} from '../../../utils/story-arc.js'
import { getChapterPlanningConfig } from '../../../utils/chapter-planning.js'
import { loadConfig } from '../../../config/store.js'
import { writeOutlineContent } from '../../../storage/filesystem/writer.js'

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
      const beatsToVerify = currentOutline?.claimedBeats && currentOutline.claimedBeats.length > 0
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
          logger.info(`[MuseFlow] 第 ${chapterIndex + 1} 章摘要生成失败，第 ${attempt}/${MAX_SUMMARY_RETRIES} 次重试...`)
        }
        try {
          const summaryOutput = await summaryAgent.run(summaryState)
          if (!summaryOutput.success) {
            logger.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章摘要 agent 返回失败: ${summaryOutput.error || '未知错误'}`)
            continue
          }
          const processed = processSummaryOutput(summaryOutput, chapterIndex, effectiveCharacters, state.storyState, chapterContent, beatsToVerify)
          if (!processed || !processed.summary) {
            logger.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章摘要处理结果为空`)
            continue
          }
          summary = processed.summary
          chapter.summary = summary
          summarySuccess = true

          if ((processed.verifiedBeats || processed.verifiedBeatEvidence) && currentOutline) {
            const newOutline = [...state.outline]
            newOutline[chapterIndex] = {
              ...currentOutline,
              ...(processed.verifiedBeats ? { verifiedBeats: processed.verifiedBeats } : {}),
              ...(processed.verifiedBeatEvidence ? { verifiedBeatEvidence: processed.verifiedBeatEvidence } : {}),
            }
            state.outline = newOutline
          }

          // 如果 SummaryAgent 返回的 verifiedBeats 没有覆盖当前幕全部 mandatory beats，
          // 再用正文内容做一次覆盖判定，避免 narrative 摘要导致 beats 被漏记。
          const actForCoverage = getActForChapter(state.storyArc, chapterIndex)
          if (actForCoverage && currentOutline && chapterContent) {
            const summaryVerified = normalizeVerifiedBeats(processed.verifiedBeats ?? [], actForCoverage.mandatoryBeats)
            const missingAfterSummary = actForCoverage.mandatoryBeats.filter(beat => !summaryVerified.includes(beat))
            if (missingAfterSummary.length > 0) {
              const contentVerified = await judgeMandatoryBeatCoverage(provider, chapterContent, actForCoverage.mandatoryBeats)
              const merged = Array.from(new Set([...summaryVerified, ...contentVerified]))
              if (merged.length > summaryVerified.length) {
                const newOutline = [...state.outline]
                const latestOutline = newOutline[chapterIndex] ?? currentOutline
                newOutline[chapterIndex] = { ...latestOutline, verifiedBeats: merged }
                state.outline = newOutline
                logger.debug(`[MuseFlow] 第 ${chapterIndex + 1} 章通过正文覆盖判定补充 ${merged.length - summaryVerified.length} 个 beats`)
              }
            }
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

      if (summarySuccess && summary && updatedStoryState) {
        const newlyEstablishedFacts = (updatedStoryState.canonicalFacts ?? []).filter(
          f => f.establishedIn === chapterIndex && f.supersedes && f.supersedes.length > 0
        )
        if (newlyEstablishedFacts.length > 0) {
          summary = patchChapterSummaryWithFacts(summary, newlyEstablishedFacts, chapterIndex)
          if (chapter) {
            chapter.summary = summary
          }
        }
      }

      if (!summarySuccess) {
        logger.warn(`[MuseFlow] 第 ${chapterIndex + 1} 章摘要生成最终失败，已阻止 finalize，避免未沉淀内容进入后续章节。`)
        return {
          pendingIssues: [
            ...state.pendingIssues,
            {
              id: generateId(),
              type: 'state_corruption',
              severity: 'error',
              description: `第 ${chapterIndex + 1} 章摘要与权威事实提取失败，无法安全进入下一章。`,
              suggestion: '请重试当前章节 finalize；如果模型持续失败，请检查模型输出或运行 rewrite 重新生成本章。',
              source: 'state_reconciliation',
              retryStrategy: 'manual',
            },
          ],
        }
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

  const { actProgress: updatedActProgress, beatPressureConstraint, beatVerificationIssues } = await updateActProgress(state, chapterIndex, provider)
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

  let updatedPendingIssues = beatVerificationIssues && beatVerificationIssues.length > 0
    ? [...state.pendingIssues, ...beatVerificationIssues]
    : state.pendingIssues

  const nextIndex = state.currentChapterIndex + 1

  let updatedStoryArc: StoryArc | null | undefined = state.storyArc
  let boundaryProposals: ReturnType<typeof proposeActBoundaryAdjustments> = []
  let updatedTotalChapters = state.totalChapters
  let updatedStory = state.story
  let updatedOutline = state.outline
  let updatedChapters = state.chapters

  if (state.storyArc) {
    boundaryProposals = proposeActBoundaryAdjustments(state.storyArc, updatedActProgress, chapterIndex)
    if (boundaryProposals.length > 0) {
      const config = loadConfig()

      if (config.autoAdjustActBoundaries) {
        for (const proposal of boundaryProposals) {
          const result = applyActBoundaryAdjustment(updatedStoryArc ?? state.storyArc, proposal, chapterIndex)
          if (result.applied) {
            updatedStoryArc = result.storyArc
            logger.info(`[MuseFlow] ${result.reason}`)
          } else {
            logger.warn(`[MuseFlow] 自动调整第 ${proposal.actIndex} 幕边界失败：${result.reason}`)
            if (result.requiresManualResolution) {
              updatedPendingIssues = [
                ...updatedPendingIssues,
                {
                  id: generateId(),
                  type: 'outline_coverage',
                  severity: 'error',
                  description: `第 ${proposal.actIndex} 幕自动延长已达到上限，仍有 mandatory beats 未消费。`,
                  suggestion: result.reason ?? '请重写当前章节消费 pending beats，或人工调整大纲/幕边界。',
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
          logger.warn(`  - 第 ${proposal.actIndex} 幕建议结束于第 ${proposal.proposedEndChapter} 章：${proposal.reason}`)
        }
        logger.warn('  如要采纳，请运行：museflow adjust-act <story-id> --act <index> --end-chapter <number>')
      }
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

  const chapterReport = buildChapterReport(
    state,
    chapter ?? null,
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
    chapterSummaries: state.chapterSummaries,
    storyState: updatedStoryState,
    verifiedConstraints: updatedVerifiedConstraints,
    actProgress: updatedActProgress,
    chapterReport,
    timeline: updatedTimeline,
    pendingIssues: updatedPendingIssues,
    outline: updatedOutline,
    storyArc: updatedStoryArc,
  }
}

function getActForChapter(storyArc: StoryArc | null | undefined, chapterIndex: number): ActArc | undefined {
  if (!storyArc) return undefined
  const chapterNumber = chapterIndex + 1
  return storyArc.acts.find(a => chapterNumber >= a.startChapter && chapterNumber <= a.endChapter)
}

function getPendingMandatoryBeats(state: ReducedGraphState, chapterIndex: number): string[] {
  const storyArc = state.storyArc
  const act = getActForChapter(storyArc, chapterIndex)
  if (!storyArc || !act) return []
  const progress = state.actProgress?.[act.index] ?? { consumed: [], pending: [...act.mandatoryBeats] }
  return act.mandatoryBeats.filter(beat => !progress.consumed.includes(beat))
}

function normalizeVerifiedBeats(rawVerifiedBeats: string[], mandatoryBeats: string[]): string[] {
  const matched = new Set<string>()
  for (const raw of rawVerifiedBeats) {
    const candidate = matchMandatoryBeat(raw, mandatoryBeats)
    if (candidate) {
      matched.add(candidate)
    }
  }
  return Array.from(matched)
}

async function updateActProgress(
  state: ReducedGraphState,
  chapterIndex: number,
  provider?: import('../../../model/provider.js').ModelProvider
): Promise<{
  actProgress: ReducedGraphState['actProgress']
  beatPressureConstraint?: string
  beatVerificationIssues?: Issue[]
}> {
  const storyArc = state.storyArc
  const act = getActForChapter(storyArc, chapterIndex)
  if (!storyArc || !act) {
    return { actProgress: state.actProgress }
  }

  const currentOutline = state.outline[chapterIndex]
  const claimedBeats = currentOutline?.claimedBeats ?? []
  const rawVerifiedBeats = currentOutline?.verifiedBeats ?? []

  // 兼容历史数据：将 narrative 形式的 verifiedBeats 归一化为 mandatory beat 原句
  const verifiedBeats = normalizeVerifiedBeats(rawVerifiedBeats, act.mandatoryBeats)

  // 每次 finalize 都根据当前幕已写章节的 verifiedBeats 重新计算消费进度，
  // 避免历史错误数据（如 narrative 摘要）导致 consumed 永久丢失。
  const consumed: string[] = []
  for (let idx = act.startChapter - 1; idx <= chapterIndex; idx++) {
    const outlineItem = state.outline[idx]
    if (!outlineItem) continue
    const normalized = normalizeVerifiedBeats(outlineItem.verifiedBeats ?? [], act.mandatoryBeats)
    for (const beat of normalized) {
      if (!consumed.includes(beat)) {
        consumed.push(beat)
      }
    }
  }
  let pending = act.mandatoryBeats.filter(beat => !consumed.includes(beat))

  const chaptersRemaining = act.endChapter - (chapterIndex + 1)
  const totalActChapters = act.endChapter - act.startChapter + 1
  const isInClosingPhase = chaptersRemaining / totalActChapters <= 0.2 && chaptersRemaining >= 0

  // 进入收尾阶段后，如果仍有 pending beats，先用章节摘要做一次 retroactive 覆盖判定，
  // 再用完整正文逐章扫描，补救历史章节 verifiedBeats 为 narrative 摘要导致的漏记。
  if (isInClosingPhase && pending.length > 0 && provider) {
    const retroactive = await judgeMandatoryBeatCoverageAcrossAct(
      provider,
      act,
      pending,
      state.chapterSummaries,
      state.outline.map(o => o.description ?? '')
    )
    for (const beat of retroactive) {
      if (!consumed.includes(beat)) {
        consumed.push(beat)
      }
    }
    pending = act.mandatoryBeats.filter(beat => !consumed.includes(beat))

    if (pending.length > 0) {
      const contentVerified = await scanActChaptersForBeats(
        state.story.outputDir,
        act,
        pending,
        provider,
        state.outline,
        chapterIndex
      )
      for (const beat of contentVerified) {
        if (!consumed.includes(beat)) {
          consumed.push(beat)
        }
      }
      pending = act.mandatoryBeats.filter(beat => !consumed.includes(beat))
    }
  }

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

async function scanActChaptersForBeats(
  outputDir: string,
  act: ActArc,
  pendingBeats: string[],
  provider: import('../../../model/provider.js').ModelProvider,
  outline: ReducedGraphState['outline'],
  currentChapterIndex: number
): Promise<string[]> {
  const newlyVerified: string[] = []
  let remaining = [...pendingBeats]

  for (let chapterNumber = act.startChapter; chapterNumber <= Math.min(act.endChapter, currentChapterIndex + 1); chapterNumber++) {
    if (remaining.length === 0) break
    const content = await readChapterContent(outputDir, chapterNumber)
    if (!content || content.trim().length === 0) continue

    const found = await judgeMandatoryBeatCoverage(provider, content, remaining)
    if (found.length === 0) continue

    const outlineIndex = chapterNumber - 1
    const outlineItem = outline[outlineIndex]
    if (outlineItem) {
      const mergedVerified = Array.from(new Set([...(outlineItem.verifiedBeats ?? []), ...found]))
      outline[outlineIndex] = { ...outlineItem, verifiedBeats: mergedVerified }
    }

    for (const beat of found) {
      if (!newlyVerified.includes(beat)) {
        newlyVerified.push(beat)
      }
      remaining = remaining.filter(b => b !== beat)
    }
  }

  return newlyVerified
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
