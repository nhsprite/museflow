import { logger } from '../../../utils/logger.js'
import type { ReducedGraphState } from '../../state.js'
import type { Issue } from '../../../types/agent.js'
import type { StoryState } from '../../../types/story-state.js'
import type { BlockingReport, BlockingReason } from '../../../types/blocking-report.js'
import { generateId } from '../../../utils/id.js'
import { createCheckpointService } from '../../../storage/checkpoint-service.js'
import { shouldForceTemporaryReplan } from '../../../utils/outline-boundary.js'
import { getChapterPlanningConfig } from '../../../utils/chapter-planning.js'
import { readChapterContentForRun } from '../../../storage/filesystem/writer.js'
import {
  isStateCorruptionIssue,
  isInterpretiveIssue,
} from '../../../core/chapter-generation/issue-classifier.js'
import { deduplicateByRule } from '../../../utils/issue-deduplication.js'
import {
  decideNextStep,
  type ChapterSession,
  type RoutingContext,
  type RoutingDeps,
} from '../../../core/chapter-generation/routing/index.js'
import { calculateIssueSetSimilarity } from '../../../core/chapter-generation/routing/issue-policy.js'
import type { RoutingDecision } from '../../../core/chapter-generation/routing/types.js'
import type { RuntimeContext } from '../../../core/context.js'
import { createChapterSession } from '../../../core/chapter-generation/routing/session.js'
import {
  createGenericVerifiedConstraint,
  normalizeVerifiedConstraints,
} from '../../../utils/verified-constraints.js'
import { resolveEntityAttribute } from '../../../utils/canonical-facts.js'
import { factAttributeFromLabel } from '../../../types/story-state.js'

export function buildChapterSession(state: ReducedGraphState): ChapterSession {
  return state.session ?? createChapterSession(state.currentChapterIndex)
}

export function mergeSessionUpdate(
  session: ChapterSession,
  sessionUpdate: Partial<ChapterSession>
): Partial<ReducedGraphState> {
  const nextSession = { ...session, ...sessionUpdate }
  return { session: nextSession }
}

function inferConflictAttribute(issue: Issue): string | undefined {
  if (issue.conflictAttribute) return issue.conflictAttribute
  const dimension = issue.dimension ?? ''
  if (dimension === 'space' || dimension === 'item_location') return 'location'
  if (dimension === 'structured_state' || dimension === 'outline_state_conflict') return 'status'
  if (dimension === 'character_knowledge') return 'known_info'
  if (dimension === 'dialogue') return 'dialogue'
  return undefined
}

function buildBlockingConflict(
  state: ReducedGraphState,
  issue: Issue
): import('../../../types/blocking-report.js').BlockingConflict {
  const attribute = inferConflictAttribute(issue) ?? issue.dimension ?? issue.type
  const source: 'outline' | 'canonical' | 'author' =
    issue.source === 'state_reconciliation' ? 'canonical' : 'outline'

  // 如果 issue 已经携带结构化冲突字段，优先直接使用。
  if (issue.actualValue !== undefined || issue.expectedValue !== undefined) {
    return {
      subject: issue.subject ?? issue.id,
      attribute,
      oldValue: issue.actualValue ?? '',
      newValue: issue.expectedValue ?? '',
      source,
    }
  }

  // 否则尝试从 storyState 读取当前权威值作为 actualValue。
  const subject = issue.subject
  const factAttribute = inferConflictAttribute(issue)
    ? factAttributeFromLabel(inferConflictAttribute(issue)!)
    : null
  if (subject && factAttribute && state.storyState) {
    const actualValue = resolveEntityAttribute(state.storyState, subject, factAttribute)
    return {
      subject,
      attribute,
      oldValue: actualValue ?? '',
      newValue: '',
      source,
    }
  }

  return {
    subject: issue.subject ?? issue.id,
    attribute,
    oldValue: '',
    newValue: '',
    source,
  }
}

function buildBlockingReport(
  state: ReducedGraphState,
  reason: BlockingReason,
  blockingIssues: Issue[]
): BlockingReport {
  const chapterIndex = state.currentChapterIndex
  const storyId = state.story.id

  // 阻断报告生成前做一次最终去重，避免同一问题因上游累积被重复打印。
  const deduplicatedIssues = deduplicateByRule(blockingIssues)

  const conflicts = deduplicatedIssues
    .filter(
      (i) =>
        i.type === 'state_corruption' ||
        i.type === 'outline_violation' ||
        i.type === 'outline_deviation'
    )
    .map((issue) => buildBlockingConflict(state, issue))

  const suggestedActions: BlockingReport['suggestedActions'] = []

  if (reason === 'rewrite_loop_stalled') {
    suggestedActions.push({
      type: 'manual_rewrite',
      description: '运行 museflow rewrite <story-id> 从本章开始人工重写',
    })
  }

  if (reason === 'state_corruption' || conflicts.length > 0) {
    suggestedActions.push(
      {
        type: 'choose_canonical',
        description:
          '若认为当前权威事实正确，请根据阻断报告调整本章大纲，或运行 museflow rewrite <story-id> 后在交互式冲突提示中选择权威事实',
      },
      {
        type: 'choose_outline',
        description:
          '若认为大纲要求正确，请运行 museflow rewrite <story-id> 后在交互式冲突提示中选择以大纲为准',
      },
      {
        type: 'author_override',
        description:
          '若需要作者裁决，请先记录裁决内容并重新运行 museflow rewrite <story-id>；当前版本未提供独立 reconcile 命令',
      }
    )
  }

  if (reason === 'max_rewrite_attempts') {
    suggestedActions.push({
      type: 'manual_rewrite',
      description: '已连续重写多次未收敛，建议人工审视问题后运行 rewrite 或 fix',
    })
  }

  return {
    id: generateId('block'),
    storyId,
    chapterIndex,
    createdAt: Date.now(),
    reason,
    summary: `第 ${chapterIndex + 1} 章写作流程因 ${reason} 停止，剩余 ${deduplicatedIssues.length} 个未解决错误。`,
    issues: deduplicatedIssues,
    conflicts,
    suggestedActions,
  }
}

/**
 * 当 structural rewrite 未收敛时，清理当前章节及后续章节由大纲解析自动写入的
 * canonicalFacts / supersededFacts。当前章节尚未 finalize，其权威事实
 * 应主要来自前章正文；大纲解析结果只应作为提示，不应持续污染状态。
 * 作者通过 CLI 做出的裁决（source='author'）属于外部权威输入，不应被清理。
 */
export function cleanCurrentChapterInferredFacts(state: ReducedGraphState): StoryState | undefined {
  const storyState = state.storyState
  if (!storyState) return undefined

  const currentChapterIndex = state.currentChapterIndex

  const canonicalFacts = storyState.canonicalFacts ?? []
  const supersededFacts = storyState.supersededFacts ?? []

  const cleanedCanonicalFacts = canonicalFacts.filter(
    (f) => f.source === 'author_override' || f.establishedIn < currentChapterIndex
  )
  const cleanedSupersededFacts = supersededFacts.filter((f) => f.chapterIndex < currentChapterIndex)

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

export async function convergeAndDecide(
  state: ReducedGraphState,
  _context: RuntimeContext
): Promise<Partial<ReducedGraphState>> {
  const session = buildChapterSession(state)
  const chapterNumber = state.currentChapterIndex + 1
  const existingContent = await readChapterContentForRun(state.story.outputDir, chapterNumber)
  const chapterFileExists = existingContent !== null && existingContent.trim().length > 0

  const routingDeps: RoutingDeps = {
    issuePolicy: {
      planningConfig: getChapterPlanningConfig(state.genre),
      isInterpretiveIssue,
      // 使用规则去重，避免 issue 在多次校验步骤中被重复累积。
      deduplicateIssues: (issues) => deduplicateByRule(issues),
      log: (level, message, ...meta) => logger[level](message, ...meta),
    },
    rewritePolicy: {
      planningConfig: getChapterPlanningConfig(state.genre),
      calculateIssueSetSimilarity: (prev, curr) => calculateIssueSetSimilarity(prev, curr),
      isInterpretiveIssue,
      isStateCorruptionIssue,
      log: (level, message, ...meta) => logger[level](message, ...meta),
    },
    fixPolicy: {
      log: (level, message, ...meta) => logger[level](message, ...meta),
    },
  }

  const ctx: RoutingContext = {
    session,
    pendingIssues: state.pendingIssues,
    genre: state.genre,
    chapterFileExists,
    structuredValidationResult: state.structuredValidationResult,
  }

  const { step, sessionUpdate, processedIssues, newConstraints } = await decideNextStep(
    ctx,
    routingDeps
  )

  const routingDecision: RoutingDecision = step.kind

  const update = mergeSessionUpdate(session, {
    ...sessionUpdate,
    routingDecision,
    rewriteAttempts: session.rewriteAttempts + 1,
    // 回写本轮问题快照，供 rewrite-policy 的相似度升级与已解决约束提取使用。
    previousIssues: processedIssues,
    previousRawErrorCount: processedIssues.filter((i) => i.severity === 'error').length,
  })

  update.pendingIssues = processedIssues

  const currentVerifiedConstraints = normalizeVerifiedConstraints(state.verifiedConstraints)
  const nextVerifiedConstraints = [
    ...currentVerifiedConstraints,
    ...newConstraints.map((text) => createGenericVerifiedConstraint(text)),
  ]
  const trimmedConstraints =
    nextVerifiedConstraints.length > getChapterPlanningConfig(state.genre).maxVerifiedConstraints
      ? nextVerifiedConstraints.slice(-getChapterPlanningConfig(state.genre).maxVerifiedConstraints)
      : nextVerifiedConstraints
  update.verifiedConstraints = trimmedConstraints

  // Handle temporary replan on outline boundary conflicts
  let chapterPlan = state.chapterPlan
  if (chapterPlan && shouldForceTemporaryReplan(state.outline, state.currentChapterIndex)) {
    logger.info('[MuseFlow] 检测到跨章节大纲桥接冲突，将临时重新规划本章...')
    chapterPlan = null
  }

  if (step.kind === 'draft_chapter' && step.discardPlan) {
    chapterPlan = null
  }

  update.chapterPlan = chapterPlan

  // Clean inferred facts when forcing structural rewrite
  if (update.session?.forceStructuralRewrite && routingDecision === 'draft_chapter') {
    const cleanedStoryState = cleanCurrentChapterInferredFacts(state)
    if (cleanedStoryState) {
      update.storyState = cleanedStoryState
    }
  }

  // Generate and persist a structured blocking report when the loop is blocked.
  if (step.kind === 'request_rewrite') {
    const reason = step.reason as BlockingReason
    const report = buildBlockingReport(state, reason, step.blockingIssues)
    update.blockingReport = report
    const checkpointService = createCheckpointService(state.story.outputDir)
    await checkpointService.saveBlockingReport(report).catch((err) => {
      logger.warn(
        `[MuseFlow] 保存阻断报告失败: ${err instanceof Error ? err.message : String(err)}`
      )
    })
  }

  return update
}

export function routeByDecision(state: ReducedGraphState): string {
  return state.session?.routingDecision ?? 'finalize_chapter'
}

export function routeAfterValidation(_state: ReducedGraphState): string {
  return 'converge_and_decide'
}

export function routeAfterFinalize(state: ReducedGraphState): string {
  if (state.rewriteRequested) {
    return 'request_rewrite'
  }
  if (state.writeOneChapterOnly) {
    return 'finalize_story'
  }
  if (state.currentChapterIndex < state.totalChapters) {
    return 'prepare_chapter'
  }
  return 'finalize_story'
}

export function routeMode(state: ReducedGraphState): string {
  return state.isWriting ? 'prepare_chapter' : 'build_world'
}
