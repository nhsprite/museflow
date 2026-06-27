import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import { readChapterContent } from '../../storage/filesystem/writer.js'
import { shouldForceTemporaryReplan } from '../../utils/outline-boundary.js'
import {
  isStructuralIssue,
  isLocalIssue,
  isTaskConsistencyIssue,
  isStateCorruptionIssue,
} from '../../core/chapter-generation/issue-classifier.js'
import {
  deduplicateIssuesSemantically,
  issueFingerprint,
} from '../../utils/issue-deduplication.js'
import { getChapterPlanningConfig } from '../../utils/chapter-planning.js'

const MAX_REWRITE_ATTEMPTS = 3
const INTERPRETIVE_ISSUE_PATTERN = /提前.*(?:剧透|揭示)|看破.*说破|感应.*反应|选择性感应|表达方式|性格驱动/

function isInterpretiveIssue(issue: ReducedGraphState['pendingIssues'][number]): boolean {
  return (
    INTERPRETIVE_ISSUE_PATTERN.test(issue.description) ||
    INTERPRETIVE_ISSUE_PATTERN.test(issue.location || '')
  )
}

function calculateIssueSetSimilarity(
  prev: ReducedGraphState['pendingIssues'],
  curr: ReducedGraphState['pendingIssues']
): number {
  if (prev.length === 0 || curr.length === 0) return 0
  const prevSet = new Set(prev.map(issueFingerprint))
  const currSet = new Set(curr.map(issueFingerprint))
  let intersection = 0
  for (const fp of currSet) {
    if (prevSet.has(fp)) intersection++
  }
  return intersection / Math.max(prevSet.size, currSet.size)
}

function capNonErrorIssuesByType(
  issues: ReducedGraphState['pendingIssues'],
  maxNonErrorIssuesPerType: number
): ReducedGraphState['pendingIssues'] {
  const groups = new Map<string, ReducedGraphState['pendingIssues']>()
  for (const issue of issues) {
    const list = groups.get(issue.type) ?? []
    list.push(issue)
    groups.set(issue.type, list)
  }

  const result: ReducedGraphState['pendingIssues'] = []
  for (const [type, list] of groups) {
    const errors = list.filter(i => i.severity === 'error')
    const nonErrors = list.filter(i => i.severity !== 'error')
    result.push(...errors)
    if (nonErrors.length <= maxNonErrorIssuesPerType) {
      result.push(...nonErrors)
    } else {
      logger.warn(
        `[MuseFlow] 检测到 ${type} 类型有 ${nonErrors.length} 个非错误问题，只保留前 ${maxNonErrorIssuesPerType} 个`
      )
      result.push(...nonErrors.slice(0, maxNonErrorIssuesPerType))
    }
  }
  return result
}

function downgradeInterpretiveErrors(
  issues: ReducedGraphState['pendingIssues']
): ReducedGraphState['pendingIssues'] {
  return issues.map(i =>
    i.severity === 'error' && isInterpretiveIssue(i)
      ? { ...i, severity: 'warning' as const }
      : i
  )
}

export async function prepare_chapter(
  _state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  return {
    rewriteAttempts: 0,
    errorRewriteAttempts: 0,
    previousIssues: [],
    previousRawErrorCount: 0,
    forceStructuralRewrite: false,
    autoFixAttempts: 0,
    routingDecision: undefined,
  }
}

export async function decide_strategy(
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const chapterIndex = state.currentChapterIndex
  const nextAttempts = (state.rewriteAttempts || 0) + 1
  const errorIssues = state.pendingIssues.filter(i => i.severity === 'error')
  const nextErrorAttempts = errorIssues.length > 0
    ? (state.errorRewriteAttempts || 0) + 1
    : (state.errorRewriteAttempts || 0)

  // 状态污染逃逸：当错误全部属于上游 storyState 污染类问题且处于重写模式时，
  // 停止重写循环并请求人工处理，避免无限重写同一章。
  if (
    state.rewriteApproved &&
    errorIssues.length > 0 &&
    errorIssues.every(isStateCorruptionIssue)
  ) {
    logger.warn('[MuseFlow] 剩余错误均为上游状态污染，停止重写循环，请求人工处理...')
    return {
      rewriteAttempts: nextAttempts,
      errorRewriteAttempts: nextErrorAttempts,
      pendingIssues: errorIssues,
      routingDecision: 'request_rewrite',
      forceStructuralRewrite: false,
      autoFixAttempts: 0,
    }
  }

  // 没有错误且未请求重写时，若当前章节文件已存在则直接进入 finalize；否则需要起草
  if (errorIssues.length === 0 && !state.rewriteApproved) {
    const existingContent = await readChapterContent(
      state.story.outputDir,
      chapterIndex + 1
    )
    if (existingContent !== null && existingContent.trim().length > 0) {
      return {
        rewriteAttempts: nextAttempts,
        routingDecision: 'finalize_chapter',
        autoFixAttempts: 0,
      }
    }
  }

  let chapterPlan = state.chapterPlan
  let pendingIssues = state.pendingIssues
  let routingDecision: 'draft_chapter' | 'fix_chapter' = 'draft_chapter'

  if (chapterPlan && shouldForceTemporaryReplan(state.outline, chapterIndex)) {
    logger.info('[MuseFlow] 检测到跨章节大纲桥接冲突，将临时重新规划本章...')
    chapterPlan = null
  }

  if (!state.rewriteApproved) {
    routingDecision = 'draft_chapter'
    pendingIssues = []
  } else {
    const chapterFileExists = await readChapterContent(
      state.story.outputDir,
      chapterIndex + 1
    ).then(c => c !== null)

    if (!chapterFileExists) {
      logger.info(`[MuseFlow] 第 ${chapterIndex + 1} 章文件不存在，跳过修复模式，直接重新起草...`)
      routingDecision = 'draft_chapter'
      pendingIssues = errorIssues
    } else {
      const hasStructural = errorIssues.some(isStructuralIssue) || state.forceStructuralRewrite
      const hasLocal = errorIssues.some(isLocalIssue)
      const hasTaskConsistency = errorIssues.some(isTaskConsistencyIssue)

      if (hasTaskConsistency) {
        logger.info('[MuseFlow] 检测到跨章节差事一致性错误，将清空计划并重新规划...')
        chapterPlan = null
        pendingIssues = errorIssues
        routingDecision = 'draft_chapter'
      } else if (hasStructural && !hasLocal) {
        logger.info('[MuseFlow] 检测到结构性问题，将重新规划并完整重写本章...')
        chapterPlan = null
        pendingIssues = errorIssues
        routingDecision = 'draft_chapter'
      } else if (!hasStructural && hasLocal) {
        logger.info('[MuseFlow] 检测到局部问题，将使用段落修复模式...')
        routingDecision = 'fix_chapter'
        pendingIssues = errorIssues
      } else if (hasStructural) {
        logger.info('[MuseFlow] 同时存在结构性和局部问题，将重新规划并完整重写...')
        chapterPlan = null
        pendingIssues = errorIssues
        routingDecision = 'draft_chapter'
      } else {
        logger.info('[MuseFlow] 检测到局部问题，将使用现有计划重写...')
        pendingIssues = errorIssues
        routingDecision = 'draft_chapter'
      }
    }
  }

  return {
    rewriteAttempts: nextAttempts,
    errorRewriteAttempts: nextErrorAttempts,
    chapterPlan,
    pendingIssues,
    routingDecision,
    forceStructuralRewrite: false,
    autoFixAttempts: 0,
  }
}

export function route_strategy(_state: ReducedGraphState): string {
  return _state.routingDecision ?? 'finalize_chapter'
}

export function convergence_check(
  state: ReducedGraphState
): Partial<ReducedGraphState> {
  const planningConfig = getChapterPlanningConfig(state.genre)

  let pendingIssues = deduplicateIssuesSemantically(state.pendingIssues)
  pendingIssues = capNonErrorIssuesByType(
    pendingIssues,
    planningConfig.maxNonErrorIssuesPerType
  )

  const currentRawErrorCount = pendingIssues.filter(i => i.severity === 'error').length
  const currentErrorIssues = pendingIssues.filter(i => i.severity === 'error')
  const previousErrors = state.previousIssues.filter(i => i.severity === 'error')
  const similarity = calculateIssueSetSimilarity(previousErrors, currentErrorIssues)

  let forceStructuralRewrite = false
  const currentRemainingErrors = pendingIssues.filter(i => i.severity === 'error')
  const onlyInterpretiveErrors =
    currentRemainingErrors.length > 0 && currentRemainingErrors.every(isInterpretiveIssue)

  if ((state.errorRewriteAttempts || 0) > 1) {
    if (currentRawErrorCount > state.previousRawErrorCount) {
      logger.info(
        `[MuseFlow] 检测到问题数量上升（${state.previousRawErrorCount} -> ${currentRawErrorCount}），修复未收敛，下次尝试将强制完整重写...`
      )
      forceStructuralRewrite = true
    } else if (similarity >= 0.5 && currentRawErrorCount > 0) {
      logger.info(
        `[MuseFlow] 检测到问题高度重复（相似度 ${Math.round(similarity * 100)}%），修复未收敛，将保留全部问题反馈并强制完整重写...`
      )
      forceStructuralRewrite = true
    } else if (onlyInterpretiveErrors && (state.errorRewriteAttempts || 0) >= MAX_REWRITE_ATTEMPTS - 1) {
      logger.info(
        `[MuseFlow] 剩余 ${currentRemainingErrors.length} 个问题均为解释性一致性问题，自动降级为 warning 以完成本章...`
      )
      pendingIssues = downgradeInterpretiveErrors(pendingIssues)
    }
  }

  // 记录已解决的问题为 verifiedConstraints
  const resolvedIssues = state.previousIssues.filter(
    prev =>
      prev.severity === 'error' &&
      !isInterpretiveIssue(prev) &&
      !pendingIssues.some(
        curr => curr.type === prev.type && curr.description === prev.description
      )
  )
  const newConstraints = resolvedIssues.map(
    issue =>
      `[${issue.type}] ${issue.description}${issue.location ? `（位置：${issue.location}）` : ''}${issue.suggestion ? `；修复方向：${issue.suggestion}` : ''}`
  )
  let verifiedConstraints = [...(state.verifiedConstraints ?? []), ...newConstraints]
  if (verifiedConstraints.length > planningConfig.maxVerifiedConstraints) {
    verifiedConstraints = verifiedConstraints.slice(-planningConfig.maxVerifiedConstraints)
    logger.warn(
      `[MuseFlow] verifiedConstraints 超过 ${planningConfig.maxVerifiedConstraints} 条，已保留最近 ${planningConfig.maxVerifiedConstraints} 条`
    )
  }
  if (resolvedIssues.length > 0) {
    logger.info(`[MuseFlow] 本轮已解决 ${resolvedIssues.length} 个问题，已记录为后续规划约束`)
    for (const constraint of newConstraints) {
      logger.info(`  ✓ ${constraint.substring(0, 120)}${constraint.length > 120 ? '...' : ''}`)
    }
  }

  const remainingErrors = pendingIssues.filter(i => i.severity === 'error')
  let routingDecision: string
  let rewriteApproved = state.rewriteApproved

  if (remainingErrors.length === 0) {
    routingDecision = 'finalize_chapter'
  } else if ((state.errorRewriteAttempts || 0) >= MAX_REWRITE_ATTEMPTS) {
    const corruptionCount = remainingErrors.filter(isStateCorruptionIssue).length
    if (corruptionCount > 0) {
      logger.error(
        `[MuseFlow] 连续 ${MAX_REWRITE_ATTEMPTS} 次重写后仍有 ${remainingErrors.length} 个错误，其中 ${corruptionCount} 个为上游状态污染问题，停止循环。`
      )
    }
    routingDecision = 'request_rewrite'
    rewriteApproved = false
  } else {
    routingDecision = 'decide_strategy'
    rewriteApproved = true
  }

  return {
    pendingIssues,
    verifiedConstraints,
    previousIssues: pendingIssues,
    previousRawErrorCount: currentRawErrorCount,
    forceStructuralRewrite,
    rewriteApproved,
    routingDecision,
    autoFixAttempts: 0,
  }
}

export function route_convergence(state: ReducedGraphState): string {
  return state.routingDecision ?? 'finalize_chapter'
}

export function route_after_validation(state: ReducedGraphState): string {
  const errors = state.pendingIssues.filter(i => i.severity === 'error')
  if (errors.length > 0) {
    return 'convergence_check'
  }
  // warning 不再触发自动修复循环，避免质量/风格类 warning 消耗重写次数。
  // 如需处理 warning，可通过独立的 polish 流程或手动 rewrite。
  return 'finalize_chapter'
}

export async function request_rewrite(
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const errors = state.pendingIssues.filter(i => i.severity === 'error')
  if (errors.length > 0) {
    logger.error('[MuseFlow] 严重问题需要重写:', errors)
  }
  return {
    rewriteRequested: true,
    rewriteApproved: false,
    routingDecision: undefined,
  }
}

export function route_after_finalize(state: ReducedGraphState): string {
  if (state.writeOneChapterOnly) {
    return 'finalize_story'
  }
  if (state.currentChapterIndex < state.totalChapters) {
    return 'prepare_chapter'
  }
  return 'finalize_story'
}

export function route_mode(state: ReducedGraphState): string {
  return state.isWriting ? 'prepare_chapter' : 'build_world'
}
