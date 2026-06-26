import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../../graph/state.js'
import { readChapterContent } from '../../storage/filesystem/writer.js'
import { shouldForceTemporaryReplan } from '../../utils/outline-boundary.js'
import { isStructuralIssue, isLocalIssue, isTaskConsistencyIssue } from './issue-classifier.js'

export interface PhaseRunners {
  runDraftPhase: (state: ReducedGraphState) => Promise<ReducedGraphState>
  runFixPhase: (state: ReducedGraphState) => Promise<ReducedGraphState>
}

export interface RewriteStrategyOptions {
  outputDir: string
  targetIndex: number
  structuralOverride: boolean
  enableStructuralBranching: boolean
  verifiedConstraints: string[]
}

export async function runRewriteBranch(
  state: ReducedGraphState,
  phaseRunners: PhaseRunners,
  options: RewriteStrategyOptions
): Promise<ReducedGraphState> {
  const { outputDir, targetIndex, structuralOverride, enableStructuralBranching, verifiedConstraints } = options
  const { runDraftPhase, runFixPhase } = phaseRunners

  if (!enableStructuralBranching) {
    return runDraftPhase({ ...state, pendingIssues: [], verifiedConstraints })
  }

  const needsTemporaryReplan = shouldForceTemporaryReplan(state.outline, targetIndex)
  if (needsTemporaryReplan && state.chapterPlan) {
    logger.info('[MuseFlow] 检测到跨章节大纲桥接冲突，将临时重新规划本章...')
    state = { ...state, chapterPlan: null }
  }

  if (!state.rewriteApproved) {
    return runDraftPhase({ ...state, pendingIssues: [], verifiedConstraints })
  }

  const errorIssues = state.pendingIssues.filter(i => i.severity === 'error')
  const chapterFileExists = await readChapterContent(outputDir, targetIndex + 1).then(c => c !== null)

  if (!chapterFileExists) {
    logger.info(`[MuseFlow] 第 ${targetIndex + 1} 章文件不存在，跳过修复模式，直接重新起草...`)
    return runDraftPhase({ ...state, pendingIssues: errorIssues, verifiedConstraints })
  }

  const hasStructural = errorIssues.some(isStructuralIssue) || structuralOverride
  const hasLocal = errorIssues.some(i => isLocalIssue(i))
  const onlyCrossChapter = errorIssues.every(i => i.type === 'consistency' || i.type === 'hallucination')
  const hasTaskConsistency = errorIssues.some(isTaskConsistencyIssue)

  if (hasTaskConsistency) {
    logger.info('[MuseFlow] 检测到跨章节差事一致性错误，将清空计划并重新规划...')
    const replanState = { ...state, chapterPlan: null, pendingIssues: errorIssues, verifiedConstraints }
    return runDraftPhase(replanState)
  }

  if (hasStructural && !hasLocal) {
    if (onlyCrossChapter && !structuralOverride) {
      logger.info('[MuseFlow] 一致性/幻觉问题优先使用段落级修复，避免直接完整重写...')
      return runFixPhase({ ...state, pendingIssues: errorIssues, verifiedConstraints })
    }
    logger.info('[MuseFlow] 检测到结构性问题，将重新规划并完整重写本章...')
    return runDraftPhase({ ...state, chapterPlan: null, pendingIssues: errorIssues, verifiedConstraints })
  }

  if (!hasStructural && hasLocal) {
    logger.info('[MuseFlow] 检测到局部问题，将使用段落修复模式...')
    return runFixPhase({ ...state, pendingIssues: errorIssues, verifiedConstraints })
  }

  if (hasStructural) {
    logger.info('[MuseFlow] 同时存在结构性和局部问题，将重新规划并完整重写...')
    state = { ...state, chapterPlan: null, pendingIssues: errorIssues, verifiedConstraints }
  } else if (hasLocal) {
    logger.info('[MuseFlow] 检测到局部问题，将使用现有计划重写...')
    state = { ...state, pendingIssues: errorIssues, verifiedConstraints }
  } else {
    state = { ...state, pendingIssues: [], verifiedConstraints }
  }
  return runDraftPhase(state)
}
