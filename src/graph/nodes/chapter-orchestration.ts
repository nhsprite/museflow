import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import { shouldForceTemporaryReplan } from '../../utils/outline-boundary.js'
import { getChapterPlanningConfig } from '../../utils/chapter-planning.js'
import { readChapterContent } from '../../storage/filesystem/writer.js'
import {
  isStructuralIssue,
  isLocalIssue,
  isTaskConsistencyIssue,
  isStateCorruptionIssue,
  isInterpretiveIssue,
} from '../../core/chapter-generation/issue-classifier.js'
import { deduplicateIssuesSemantically, ruleBasedFingerprint } from '../../utils/issue-deduplication.js'
import { createProvider } from '../../model/registry.js'
import type { StoryState } from '../../types/story-state.js'
import type { Issue, IssueSeverity } from '../../types/agent.js'

export type RoutingDecision =
  | 'draft_chapter'
  | 'fix_chapter'
  | 'finalize_chapter'
  | 'request_rewrite'
  | 'decide_strategy'

export interface RewriteRoutingConfig {
  maxErrorRewriteAttempts: number
  maxNonErrorIssuesPerType: number
  maxVerifiedConstraints: number
  issueSetSimilarityThreshold: number
  downgradeInterpretiveErrors: boolean
  /** 是否使用 LLM 对 issue 进行二次分类复核。默认 false，使用确定性规则分类。 */
  useLLMForIssueClassification: boolean
}

export const DEFAULT_REWRITE_ROUTING_CONFIG: Required<RewriteRoutingConfig> = {
  maxErrorRewriteAttempts: 3,
  maxNonErrorIssuesPerType: 3,
  maxVerifiedConstraints: 20,
  issueSetSimilarityThreshold: 0.5,
  downgradeInterpretiveErrors: true,
  useLLMForIssueClassification: false,
}

export interface RewriteConvergenceResult {
  decision: RoutingDecision
  rewriteApproved: boolean
  pendingIssues: Issue[]
  verifiedConstraints: string[]
  forceStructuralRewrite: boolean
  autoFixAttempts: number
}

export interface InterpretiveDowngradeResult {
  issues: Issue[]
  downgraded: boolean
}

function withSeverity(issue: Issue, severity: IssueSeverity): Issue {
  return { ...issue, severity }
}

export function capNonErrorIssuesByType(
  issues: Issue[],
  maxPerType: number,
  log: (level: 'info' | 'warn' | 'error', message: string, ...meta: unknown[]) => void
): Issue[] {
  const groups = new Map<string, Issue[]>()
  for (const issue of issues) {
    const list = groups.get(issue.type) ?? []
    list.push(issue)
    groups.set(issue.type, list)
  }

  const result: Issue[] = []
  for (const [type, list] of groups) {
    const errors = list.filter(i => i.severity === 'error')
    const nonErrors = list.filter(i => i.severity !== 'error')
    result.push(...errors)
    if (nonErrors.length <= maxPerType) {
      result.push(...nonErrors)
    } else {
      log(
        'warn',
        `[MuseFlow] 检测到 ${type} 类型有 ${nonErrors.length} 个非错误问题，只保留前 ${maxPerType} 个`
      )
      result.push(...nonErrors.slice(0, maxPerType))
    }
  }
  return result
}

function buildLightweightFingerprint(issue: Issue): string {
  return ruleBasedFingerprint(issue)
}

export async function calculateIssueSetSimilarity(
  prev: Issue[],
  curr: Issue[],
  issueFingerprint?: (issue: Issue) => Promise<string>
): Promise<number> {
  if (prev.length === 0 || curr.length === 0) return 0
  const fingerprintFn = issueFingerprint ?? (async issue => buildLightweightFingerprint(issue))
  const prevFps = await Promise.all(prev.map(fingerprintFn))
  const currFps = await Promise.all(curr.map(fingerprintFn))
  const prevSet = new Set(prevFps)
  const currSet = new Set(currFps)
  let intersection = 0
  for (const fp of currSet) {
    if (prevSet.has(fp)) intersection++
  }
  return intersection / Math.max(prevSet.size, currSet.size)
}

export async function downgradeInterpretiveErrors(
  issues: Issue[],
  isInterpretiveIssue: (issue: Issue) => Promise<boolean>
): Promise<InterpretiveDowngradeResult> {
  let downgraded = false
  const result = await Promise.all(
    issues.map(async issue => {
      if (issue.severity === 'error' && (await isInterpretiveIssue(issue))) {
        downgraded = true
        return withSeverity(issue, 'warning')
      }
      return issue
    })
  )
  return { issues: result, downgraded }
}

export async function buildVerifiedConstraints(
  previousIssues: Issue[],
  currentIssues: Issue[],
  isInterpretiveIssue: (issue: Issue) => Promise<boolean>,
  maxConstraints: number,
  log: (level: 'info' | 'warn' | 'error', message: string, ...meta: unknown[]) => void
): Promise<{ constraints: string[]; resolvedCount: number }> {
  const resolvedIssues: Issue[] = []
  for (const prev of previousIssues) {
    if (prev.severity !== 'error') continue
    if (await isInterpretiveIssue(prev)) continue
    const stillPresent = currentIssues.some(
      curr => curr.type === prev.type && curr.description === prev.description
    )
    if (!stillPresent) {
      resolvedIssues.push(prev)
    }
  }

  const newConstraints = resolvedIssues.map(
    issue =>
      `[${issue.type}] ${issue.description}${
        issue.location ? `（位置：${issue.location}）` : ''
      }${issue.suggestion ? `；修复方向：${issue.suggestion}` : ''}`
  )

  if (newConstraints.length > 0) {
    log('info', `[MuseFlow] 本轮已解决 ${resolvedIssues.length} 个问题，已记录为后续规划约束`)
    for (const constraint of newConstraints) {
      log(
        'info',
        `  ✓ ${constraint.substring(0, 120)}${constraint.length > 120 ? '...' : ''}`
      )
    }
  }

  let constraints = newConstraints
  if (newConstraints.length > maxConstraints) {
    constraints = newConstraints.slice(
      Math.max(0, newConstraints.length - maxConstraints)
    )
    log(
      'warn',
      `[MuseFlow] verifiedConstraints 超过 ${maxConstraints} 条，已保留最近 ${maxConstraints} 条`
    )
  }

  return { constraints, resolvedCount: resolvedIssues.length }
}

function buildRoutingConfig(genre: string): Required<RewriteRoutingConfig> {
  const planningConfig = getChapterPlanningConfig(genre)
  return {
    ...DEFAULT_REWRITE_ROUTING_CONFIG,
    maxNonErrorIssuesPerType: planningConfig.maxNonErrorIssuesPerType,
    maxVerifiedConstraints: planningConfig.maxVerifiedConstraints,
  }
}

/**
 * 当 structural rewrite 未收敛时，清理当前章节由大纲解析自动写入的
 * canonicalFacts / supersededFacts。当前章节尚未 finalize，其权威事实
 * 应主要来自前章正文；大纲解析结果只应作为提示，不应持续污染状态。
 * 作者通过 CLI 做出的裁决（source='author'）属于外部权威输入，不应被清理。
 */
function cleanCurrentChapterInferredFacts(state: ReducedGraphState): StoryState | undefined {
  const storyState = state.storyState
  if (!storyState) return undefined

  const currentDisplayChapter = state.currentChapterIndex + 1
  const currentChapterIndex = state.currentChapterIndex

  const canonicalFacts = storyState.canonicalFacts ?? []
  const supersededFacts = storyState.supersededFacts ?? []

  const cleanedCanonicalFacts = canonicalFacts.filter(
    f => f.establishedIn !== currentDisplayChapter || f.source === 'author'
  )
  const cleanedSupersededFacts = supersededFacts.filter(
    f => f.chapterIndex !== currentChapterIndex
  )

  const hasChanges =
    cleanedCanonicalFacts.length !== canonicalFacts.length ||
    cleanedSupersededFacts.length !== supersededFacts.length

  if (!hasChanges) return undefined

  logger.info(
    `[MuseFlow] 重写未收敛，清理当前章节由大纲自动预授权/推断的 ${canonicalFacts.length - cleanedCanonicalFacts.length} 条权威事实与 ${supersededFacts.length - cleanedSupersededFacts.length} 条覆盖记录`
  )

  return {
    ...storyState,
    canonicalFacts: cleanedCanonicalFacts,
    supersededFacts: cleanedSupersededFacts,
  }
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
    authorDecisions: {},
  }
}

async function anyIssueMatches(
  issues: Issue[],
  predicate: (issue: Issue) => Promise<boolean>
): Promise<boolean> {
  for (const issue of issues) {
    if (await predicate(issue)) return true
  }
  return false
}

async function allIssuesMatch(
  issues: Issue[],
  predicate: (issue: Issue) => Promise<boolean>
): Promise<boolean> {
  if (issues.length === 0) return false
  for (const issue of issues) {
    if (!(await predicate(issue))) return false
  }
  return true
}

async function countMatchingIssues(
  issues: Issue[],
  predicate: (issue: Issue) => Promise<boolean>
): Promise<number> {
  let count = 0
  for (const issue of issues) {
    if (await predicate(issue)) count++
  }
  return count
}

async function decideRoutingStrategy(
  state: ReducedGraphState
): Promise<{
  decision: RoutingDecision
  discardPlan: boolean
  feedbackIssues: Issue[]
  rewriteApproved: boolean
}> {
  const config = buildRoutingConfig(state.genre)
  const preferLLM = config.useLLMForIssueClassification
  const chapterIndex = state.currentChapterIndex
  const rewriteApproved = state.rewriteApproved
  const pendingIssues = state.pendingIssues
  const outputDir = state.story.outputDir
  const chapterNumber = chapterIndex + 1
  const errorIssues = pendingIssues.filter(i => i.severity === 'error')

  if (
    rewriteApproved &&
    errorIssues.length > 0 &&
    (await allIssuesMatch(errorIssues, issue => isStateCorruptionIssue(undefined, issue, preferLLM)))
  ) {
    logger.warn('[MuseFlow] 剩余错误均为上游状态污染，停止重写循环，请求人工处理...')
    return {
      decision: 'request_rewrite',
      discardPlan: false,
      feedbackIssues: errorIssues,
      rewriteApproved: false,
    }
  }

  if (errorIssues.length === 0 && !rewriteApproved) {
    const existingContent = await readChapterContent(outputDir, chapterNumber)
    if (existingContent !== null && existingContent.trim().length > 0) {
      return {
        decision: 'finalize_chapter',
        discardPlan: false,
        feedbackIssues: [],
        rewriteApproved: false,
      }
    }
  }

  let discardPlan = false
  let decision: Extract<RoutingDecision, 'draft_chapter' | 'fix_chapter'> = 'draft_chapter'
  let feedbackIssues = errorIssues

  if (!rewriteApproved) {
    decision = 'draft_chapter'
    feedbackIssues = []
  } else {
    const chapterFileExists = (await readChapterContent(outputDir, chapterNumber)) !== null

    if (!chapterFileExists) {
      logger.info(`[MuseFlow] 第 ${chapterNumber} 章文件不存在，跳过修复模式，直接重新起草...`)
      decision = 'draft_chapter'
      feedbackIssues = errorIssues
    } else {
      const hasStructural =
        (await anyIssueMatches(errorIssues, issue => isStructuralIssue(undefined, issue, preferLLM))) ||
        (state.forceStructuralRewrite || false)
      const hasLocal = await anyIssueMatches(errorIssues, issue => isLocalIssue(undefined, issue, preferLLM))
      const hasTaskConsistency = await anyIssueMatches(
        errorIssues,
        issue => isTaskConsistencyIssue(undefined, issue, preferLLM)
      )

      if (hasTaskConsistency) {
        logger.info('[MuseFlow] 检测到跨章节差事一致性错误，将清空计划并重新规划...')
        discardPlan = true
        feedbackIssues = errorIssues
        decision = 'draft_chapter'
      } else if (hasStructural && !hasLocal) {
        logger.info('[MuseFlow] 检测到结构性问题，将重新规划并完整重写本章...')
        discardPlan = true
        feedbackIssues = errorIssues
        decision = 'draft_chapter'
      } else if (!hasStructural && hasLocal) {
        logger.info('[MuseFlow] 检测到局部问题，将使用段落修复模式...')
        decision = 'fix_chapter'
        feedbackIssues = errorIssues
      } else if (hasStructural) {
        logger.info('[MuseFlow] 同时存在结构性和局部问题，将重新规划并完整重写...')
        discardPlan = true
        feedbackIssues = errorIssues
        decision = 'draft_chapter'
      } else {
        logger.info('[MuseFlow] 检测到局部问题，将使用现有计划重写...')
        decision = 'draft_chapter'
        feedbackIssues = errorIssues
      }
    }
  }

  return {
    decision,
    discardPlan,
    feedbackIssues,
    rewriteApproved: true,
  }
}

async function convergenceCheck(
  state: ReducedGraphState
): Promise<RewriteConvergenceResult> {
  const config = buildRoutingConfig(state.genre)
  const preferLLM = config.useLLMForIssueClassification

  let dedupedIssues = config.useLLMForIssueClassification
    ? await deduplicateIssuesSemantically(createProvider(), state.pendingIssues)
    : state.pendingIssues
  dedupedIssues = capNonErrorIssuesByType(
    dedupedIssues,
    config.maxNonErrorIssuesPerType,
    (level, message, ...meta) => logger[level](message, ...meta)
  )

  const currentRawErrorCount = dedupedIssues.filter(i => i.severity === 'error').length
  const currentErrorIssues = dedupedIssues.filter(i => i.severity === 'error')
  const previousErrors = state.previousIssues.filter(i => i.severity === 'error')
  const similarity = await calculateIssueSetSimilarity(previousErrors, currentErrorIssues)

  let forceStructuralRewrite = false
  const currentRemainingErrors = dedupedIssues.filter(i => i.severity === 'error')
  const onlyInterpretiveErrors =
    currentRemainingErrors.length > 0 &&
    (await allIssuesMatch(currentRemainingErrors, issue => isInterpretiveIssue(undefined, issue, preferLLM)))

  const errorCountIncreased = currentRawErrorCount > (state.previousRawErrorCount || 0)
  const issuesHighlySimilar =
    similarity >= config.issueSetSimilarityThreshold && currentRawErrorCount > 0

  const hasStateCorruptionError = await anyIssueMatches(
    currentErrorIssues,
    issue => isStateCorruptionIssue(undefined, issue, preferLLM)
  )

  const errorRewriteAttempts = state.errorRewriteAttempts || 0

  if (errorRewriteAttempts > 1) {
    if (errorCountIncreased) {
      logger.info(
        `[MuseFlow] 检测到问题数量上升（${state.previousRawErrorCount || 0} -> ${currentRawErrorCount}），修复未收敛，下次尝试将强制完整重写...`
      )
      forceStructuralRewrite = true
    } else if (issuesHighlySimilar) {
      logger.info(
        `[MuseFlow] 检测到问题高度重复（相似度 ${Math.round(similarity * 100)}%），修复未收敛，将保留全部问题反馈并强制完整重写...`
      )
      forceStructuralRewrite = true
    }
  }

  if (
    !forceStructuralRewrite &&
    config.downgradeInterpretiveErrors &&
    onlyInterpretiveErrors &&
    errorRewriteAttempts >= config.maxErrorRewriteAttempts - 1
  ) {
    logger.info(
      `[MuseFlow] 剩余 ${currentRemainingErrors.length} 个问题均为解释性一致性问题，自动降级为 warning 以完成本章...`
    )
    const downgrade = await downgradeInterpretiveErrors(
      dedupedIssues,
      issue => isInterpretiveIssue(undefined, issue, preferLLM)
    )
    dedupedIssues = downgrade.issues
  }

  const { constraints: newConstraints } = await buildVerifiedConstraints(
    state.previousIssues,
    dedupedIssues,
    issue => isInterpretiveIssue(undefined, issue, preferLLM),
    config.maxVerifiedConstraints,
    (level, message, ...meta) => logger[level](message, ...meta)
  )

  const updatedConstraints = [...state.verifiedConstraints ?? [], ...newConstraints]
  const trimmedConstraints =
    updatedConstraints.length > config.maxVerifiedConstraints
      ? updatedConstraints.slice(-config.maxVerifiedConstraints)
      : updatedConstraints

  if (
    errorRewriteAttempts > 1 &&
    issuesHighlySimilar &&
    hasStateCorruptionError
  ) {
    logger.warn(
      `[MuseFlow] 检测到问题高度重复且涉及上游状态污染（相似度 ${Math.round(similarity * 100)}%），继续重写无法收敛，将停止循环并请求状态级修复...`
    )
    return {
      decision: 'request_rewrite',
      rewriteApproved: false,
      pendingIssues: dedupedIssues,
      verifiedConstraints: trimmedConstraints,
      forceStructuralRewrite: false,
      autoFixAttempts: state.autoFixAttempts || 0,
    }
  }

  const remainingErrors = dedupedIssues.filter(i => i.severity === 'error')
  let decision: RoutingDecision
  let nextRewriteApproved = state.rewriteApproved

  if (remainingErrors.length === 0) {
    const warnings = dedupedIssues.filter(i => i.severity === 'warning')
    const patchableWarnings = warnings.filter(issue => {
      if (issue.type === 'consistency' && issue.dimension !== 'quality') return true
      if (issue.type === 'consistency' && issue.dimension === 'quality' && issue.location) {
        return /第\s*\d+\s*[段节]|段落\s*\d+|第\s*\d+\s*句/.test(issue.location)
      }
      return false
    })
    const autoFixAttempts = state.autoFixAttempts || 0

    if (patchableWarnings.length > 0 && autoFixAttempts < 3) {
      logger.warn(`\x1b[93m🔧 [MuseFlow] Auto-fixing ${patchableWarnings.length} warning(s) (attempt ${autoFixAttempts + 1}/3):\x1b[0m`)
      for (const warning of patchableWarnings) {
        logger.warn(`   \x1b[33m⚠️  [${warning.type}]\x1b[0m ${warning.description}`)
      }
      decision = 'fix_chapter'
      nextRewriteApproved = true
      dedupedIssues = patchableWarnings
    } else if (!state.rewriteApproved) {
      // 首次进入本章且尚无有效正文，应从起草开始，而不是直接 finalize。
      const existingContent = await readChapterContent(state.story.outputDir, state.currentChapterIndex + 1)
      if (existingContent !== null && existingContent.trim().length > 0) {
        decision = 'finalize_chapter'
        nextRewriteApproved = false
      } else {
        decision = 'draft_chapter'
        nextRewriteApproved = false
      }
    } else if ((state.rewriteAttempts || 0) === 0) {
      // 用户显式请求重写（rewrite/continue --yes），且是本轮第一次决策：
      // 即使当前没有错误，也应先走起草/修复流程，而不是直接 finalize。
      decision = 'decide_strategy'
      nextRewriteApproved = true
    } else {
      decision = 'finalize_chapter'
      nextRewriteApproved = false
    }
  } else if (errorRewriteAttempts >= config.maxErrorRewriteAttempts) {
    const corruptionCount = await countMatchingIssues(
      remainingErrors,
      issue => isStateCorruptionIssue(undefined, issue, preferLLM)
    )
    if (corruptionCount > 0) {
      logger.error(
        `[MuseFlow] 连续 ${config.maxErrorRewriteAttempts} 次重写后仍有 ${remainingErrors.length} 个错误，其中 ${corruptionCount} 个为上游状态污染问题，停止循环。`
      )
    }
    decision = 'request_rewrite'
    nextRewriteApproved = false
  } else {
    decision = 'decide_strategy'
    nextRewriteApproved = true
  }

  const nextAutoFixAttempts = decision === 'fix_chapter'
    ? (state.autoFixAttempts || 0) + 1
    : state.autoFixAttempts || 0

  return {
    decision,
    rewriteApproved: nextRewriteApproved,
    pendingIssues: dedupedIssues,
    verifiedConstraints: trimmedConstraints,
    forceStructuralRewrite,
    autoFixAttempts: nextAutoFixAttempts,
  }
}

export async function converge_and_decide(
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const convergenceResult = await convergenceCheck(state)

  const nextAttempts = (state.rewriteAttempts || 0) + 1
  const errorIssues = convergenceResult.pendingIssues.filter(i => i.severity === 'error')
  const nextErrorAttempts = errorIssues.length > 0
    ? (state.errorRewriteAttempts || 0) + 1
    : (state.errorRewriteAttempts || 0)

  let routingDecision = convergenceResult.decision
  let feedbackIssues = convergenceResult.pendingIssues

  if (convergenceResult.decision === 'decide_strategy') {
    const strategy = await decideRoutingStrategy({
      ...state,
      pendingIssues: convergenceResult.pendingIssues,
      rewriteApproved: convergenceResult.rewriteApproved,
      forceStructuralRewrite: convergenceResult.forceStructuralRewrite,
    })
    routingDecision = strategy.decision
    feedbackIssues = strategy.feedbackIssues
  }

  let chapterPlan = state.chapterPlan
  if (chapterPlan && shouldForceTemporaryReplan(state.outline, state.currentChapterIndex)) {
    logger.info('[MuseFlow] 检测到跨章节大纲桥接冲突，将临时重新规划本章...')
    chapterPlan = null
  }

  if (routingDecision === 'draft_chapter') {
    const strategy = await decideRoutingStrategy({
      ...state,
      pendingIssues: feedbackIssues,
      rewriteApproved: convergenceResult.rewriteApproved,
      forceStructuralRewrite: convergenceResult.forceStructuralRewrite,
    })
    if (strategy.discardPlan) {
      chapterPlan = null
    }
  }

  const update: Partial<ReducedGraphState> = {
    pendingIssues: convergenceResult.pendingIssues,
    verifiedConstraints: convergenceResult.verifiedConstraints,
    previousIssues: convergenceResult.pendingIssues,
    previousRawErrorCount: convergenceResult.pendingIssues.filter(i => i.severity === 'error').length,
    forceStructuralRewrite: convergenceResult.forceStructuralRewrite,
    rewriteApproved: convergenceResult.rewriteApproved,
    routingDecision,
    rewriteAttempts: nextAttempts,
    errorRewriteAttempts: nextErrorAttempts,
    chapterPlan,
    autoFixAttempts: convergenceResult.autoFixAttempts,
  }

  if (convergenceResult.forceStructuralRewrite && routingDecision === 'draft_chapter') {
    const cleanedStoryState = cleanCurrentChapterInferredFacts(state)
    if (cleanedStoryState) {
      update.storyState = cleanedStoryState
    }
  }

  return update
}

export function route_by_decision(state: ReducedGraphState): string {
  return state.routingDecision ?? 'finalize_chapter'
}

export function route_after_validation(_state: ReducedGraphState): string {
  return 'converge_and_decide'
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
