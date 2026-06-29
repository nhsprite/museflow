import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type { AgentState } from '../../agents/base.js'
import { getSummaryAgent } from '../agent-factory.js'
import { processSummaryOutput } from '../../agents/index.js'
import { readChapterContent } from '../../storage/filesystem/writer.js'
import { saveChapterReport } from '../../storage/meta/stores/chapter-report.js'
import { getForeshadowAlerts } from '../../types/foreshadow.js'
import { generateId } from '../../utils/id.js'
import { getCheckpointer } from '../checkpointer.js'
import { agePendingTasks } from '../../utils/pending-tasks.js'
import { mergeStoryState } from '../utils/reconciler.js'
import { buildEffectiveCharactersList } from '../utils/characters.js'
import { generateForeshadowConstraints } from '../../utils/foreshadow-constraints.js'
import {
  createEmptyChapterReport,
  summarizeIssues,
  type StateCorrection,
  type ChapterReport,
} from '../../types/chapter-report.js'
import { countChineseWords } from '../../utils/text.js'

export async function finalize_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
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
      const summaryAgent = getSummaryAgent()
      const { merged: effectiveCharacters, outline: outlineCharacters, established: establishedCharacters } = buildEffectiveCharactersList(state, chapterIndex)
      const summaryState: AgentState = {
        idea: state.idea,
        genre: state.genre,
        totalChapters: state.totalChapters,
        chapterContent,
        charactersList: effectiveCharacters,
        outlineCharacters,
        establishedCharacters,
        ...(state.outline[chapterIndex]?.title ? { chapterTitle: state.outline[chapterIndex].title } : {}),
        chapterIndex,
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

  const snapshot: import('../../types/timeline.js').StateSnapshot = {
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
  const updatedVerifiedConstraints = newForeshadowConstraints.length > 0
    ? [...(state.verifiedConstraints ?? []), ...newForeshadowConstraints]
    : (state.verifiedConstraints ?? [])

  const nextIndex = state.currentChapterIndex + 1

  const chapterReport = buildChapterReport(
    state,
    chapter ?? null,
    chapterContent,
    updatedStoryState
  )
  saveChapterReport(state.story.outputDir, chapterReport)

  const checkpointer = getCheckpointer()
  await checkpointer.pruneIntermediateCheckpoints(state.story.outputDir).catch(() => {})
  await checkpointer.clearPendingWrites(state.story.outputDir).catch(() => {})

  return {
    currentChapterIndex: nextIndex,
    chapterSummaries: state.chapterSummaries,
    storyState: updatedStoryState,
    verifiedConstraints: updatedVerifiedConstraints,
    chapterReport,
    timeline: updatedTimeline,
  }
}

function buildChapterReport(
  state: ReducedGraphState,
  chapter: ReducedGraphState['chapters'][number],
  chapterContent: string,
  updatedStoryState: ReducedGraphState['storyState']
): ChapterReport {
  const chapterIndex = state.currentChapterIndex
  const outlineItem = state.outline[chapterIndex]

  const report = createEmptyChapterReport(state.story.id, chapterIndex)
  report.chapterTitle = outlineItem?.title ?? chapter?.title ?? ''
  report.wordCount = countChineseWords(chapterContent)
  report.summary = chapter?.summary ?? null

  report.draftStrategy = inferDraftStrategy(state)
  report.rewriteAttempts = state.rewriteAttempts ?? 0
  report.errorRewriteAttempts = state.errorRewriteAttempts ?? 0
  report.autoFixAttempts = state.autoFixAttempts ?? 0

  report.issues = state.pendingIssues
  report.issuesSummary = summarizeIssues(state.pendingIssues)

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

  return report
}

function inferDraftStrategy(state: ReducedGraphState): ChapterReport['draftStrategy'] {
  if (state.routingDecision === 'fix_chapter') return 'fix'
  if (state.routingDecision === 'finalize_chapter' && (state.rewriteAttempts ?? 0) === 0) {
    return 'finalize-only'
  }
  if ((state.autoFixAttempts ?? 0) > 0) return 'fix'
  return 'draft'
}

function inferConvergence(state: ReducedGraphState): ChapterReport['convergence'] {
  if (!state.rewriteRequested) return 'success'
  if ((state.errorRewriteAttempts ?? 0) >= 3) return 'max-attempts-reached'
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

export async function finalize_story(_state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return {}
}
