import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type { AgentState } from '../../agents/base.js'
import { getSummaryAgent } from '../agent-factory.js'
import { processSummaryOutput } from '../../agents/index.js'
import { readChapterContent } from '../../storage/filesystem/writer.js'
import {
  appendTimelineSnapshot,
  saveForeshadowStack,
  saveForeshadowAlerts,
} from '../../storage/database/dao/timeline.js'
import { getForeshadowAlerts } from '../state.js'

import { getCheckpointer } from '../checkpointer.js'
import { agePendingTasks } from '../../utils/pending-tasks.js'
import { mergeStoryState } from '../utils/story-state.js'
import { buildEffectiveCharactersList } from '../utils/characters.js'
import { generateForeshadowConstraints } from '../../utils/foreshadow-constraints.js'

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

  void appendTimelineSnapshot(state.story.id, {
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
  })

  saveForeshadowStack(state.story.id, state.foreshadowStack)

  const alerts = getForeshadowAlerts(state.foreshadowStack, chapterIndex + 1)
  saveForeshadowAlerts(state.story.id, alerts)

  const newForeshadowConstraints = generateForeshadowConstraints(state.foreshadowStack, chapterIndex + 1)
  const updatedVerifiedConstraints = newForeshadowConstraints.length > 0
    ? [...(state.verifiedConstraints ?? []), ...newForeshadowConstraints]
    : (state.verifiedConstraints ?? [])

  const nextIndex = state.currentChapterIndex + 1

  const checkpointer = getCheckpointer()
  await checkpointer.pruneIntermediateCheckpoints(state.story.outputDir).catch(() => {})
  await checkpointer.clearPendingWrites(state.story.outputDir).catch(() => {})

  return {
    currentChapterIndex: nextIndex,
    chapterSummaries: state.chapterSummaries,
    storyState: updatedStoryState,
    verifiedConstraints: updatedVerifiedConstraints,
  }
}

export async function finalize_story(_state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return {}
}

export async function auto_fix_warnings(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const errors = state.pendingIssues.filter(i => i.severity === 'error')
  const warnings = state.pendingIssues.filter(i => i.severity === 'warning')

  if (errors.length > 0) {
    return { autoFixAttempts: 0 }
  }

  if (warnings.length === 0) {
    return { autoFixAttempts: 0 }
  }

  const attempts = (state.autoFixAttempts || 0)

  if (attempts >= 3) {
    logger.warn(`\x1b[93m[MuseFlow] 自动修复已达最大尝试次数 (${attempts})，停止修复，保留 ${warnings.length} 个警告待处理\x1b[0m`)
    return { autoFixAttempts: attempts, pendingIssues: state.pendingIssues }
  }

  const patchableWarnings = warnings.filter(issue => {
    if (issue.type === 'consistency' || issue.type === 'hallucination') return true
    if (issue.type === 'quality' && issue.location) {
      return /第\s*\d+\s*[段节]|段落\s*\d+|第\s*\d+\s*句/.test(issue.location)
    }
    return false
  })

  if (patchableWarnings.length === 0) {
    logger.info('[MuseFlow] 当前警告不适合自动修复，保留至下一轮重写')
    return { autoFixAttempts: attempts, pendingIssues: state.pendingIssues }
  }

  logger.warn(`\x1b[93m🔧 [MuseFlow] Auto-fixing ${patchableWarnings.length} warning(s) (attempt ${attempts + 1}/3):\x1b[0m`)
  for (const warning of patchableWarnings) {
    logger.warn(`   \x1b[33m⚠️  [${warning.type}]\x1b[0m ${warning.description}`)
  }

  const { fix_chapter } = await import('./fix.js')
  const fixState: ReducedGraphState = { ...state, pendingIssues: patchableWarnings }

  try {
    const fixResult = await fix_chapter(fixState)
    logger.info(`\x1b[92m✔ [MuseFlow] Auto-fixed ${patchableWarnings.length} warning(s) (attempt ${attempts + 1}/3)\x1b[0m`)

    return {
      ...fixResult,
      pendingIssues: [],
      autoFixAttempts: attempts + 1,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`\x1b[93m[MuseFlow] 自动修复失败：${message}\x1b[0m`)
    return {
      autoFixAttempts: attempts + 1,
      pendingIssues: state.pendingIssues,
    }
  }
}
