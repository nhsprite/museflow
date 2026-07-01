import { logger } from '../../../utils/logger.js'
import type { ReducedGraphState } from '../../state.js'
import type { Issue } from '../../../types/agent.js'
import type { StoryState } from '../../../types/story-state.js'
import { shouldForceTemporaryReplan } from '../../../utils/outline-boundary.js'
import { getChapterPlanningConfig } from '../../../utils/chapter-planning.js'
import { readChapterContent } from '../../../storage/filesystem/writer.js'
import {
  isStructuralIssue,
  isLocalIssue,
  isTaskConsistencyIssue,
  isStateCorruptionIssue,
  isInterpretiveIssue,
} from '../../../core/chapter-generation/issue-classifier.js'
import { deduplicateIssuesSemantically, issueFingerprint } from '../../../utils/issue-deduplication.js'
import {
  decideNextStep,
  capNonErrorIssuesByType,
  calculateIssueSetSimilarity,
  type ChapterSession,
  type RoutingContext,
  type RoutingDeps,
} from '../../../core/chapter-generation/routing/index.js'
import type { RoutingDecision, RewriteRoutingConfig } from './types.js'
import { DEFAULT_REWRITE_ROUTING_CONFIG } from './types.js'
import type { RuntimeContext } from '../../../core/context.js'

export { DEFAULT_REWRITE_ROUTING_CONFIG }

export function buildRoutingConfig(genre: string): Required<RewriteRoutingConfig> {
  const planningConfig = getChapterPlanningConfig(genre)
  return {
    ...DEFAULT_REWRITE_ROUTING_CONFIG,
    maxNonErrorIssuesPerType: planningConfig.maxNonErrorIssuesPerType,
    maxVerifiedConstraints: planningConfig.maxVerifiedConstraints,
  }
}

export function buildChapterSession(state: ReducedGraphState): ChapterSession {
  return (
    state.session ?? {
      chapterIndex: state.currentChapterIndex,
      rewriteAttempts: 0,
      errorRewriteAttempts: 0,
      autoFixAttempts: 0,
      previousIssues: [],
      previousRawErrorCount: 0,
      routingDecision: undefined,
      forceStructuralRewrite: false,
      rewriteApproved: false,
    }
  )
}

export function mergeSessionUpdate(
  session: ChapterSession,
  sessionUpdate: Partial<ChapterSession>
): Partial<ReducedGraphState> {
  const nextSession = { ...session, ...sessionUpdate }
  return { session: nextSession }
}

/**
 * 当 structural rewrite 未收敛时，清理当前章节由大纲解析自动写入的
 * canonicalFacts / supersededFacts。当前章节尚未 finalize，其权威事实
 * 应主要来自前章正文；大纲解析结果只应作为提示，不应持续污染状态。
 * 作者通过 CLI 做出的裁决（source='author'）属于外部权威输入，不应被清理。
 */
export function cleanCurrentChapterInferredFacts(state: ReducedGraphState): StoryState | undefined {
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

export async function convergeAndDecide(
  state: ReducedGraphState,
  context: RuntimeContext
): Promise<Partial<ReducedGraphState>> {
  const session = buildChapterSession(state)
  const chapterNumber = state.currentChapterIndex + 1
  const existingContent = await readChapterContent(state.story.outputDir, chapterNumber)
  const chapterFileExists = existingContent !== null && existingContent.trim().length > 0

  const config = buildRoutingConfig(state.genre)
  const preferLLM = config.useLLMForIssueClassification

  const routingDeps: RoutingDeps = {
    issuePolicy: {
      planningConfig: getChapterPlanningConfig(state.genre),
      isInterpretiveIssue: issue => isInterpretiveIssue(undefined, issue, preferLLM),
      deduplicateIssues: async issues => {
        if (config.useLLMForIssueClassification) {
          return deduplicateIssuesSemantically(context.provider, issues)
        }
        return issues
      },
      log: (level, message, ...meta) => logger[level](message, ...meta),
    },
    rewritePolicy: {
      planningConfig: getChapterPlanningConfig(state.genre),
      calculateIssueSetSimilarity: (prev, curr) =>
        calculateIssueSetSimilarity(prev, curr, async issue =>
          issueFingerprint(undefined, issue)
        ),
      isInterpretiveIssue: issue => isInterpretiveIssue(undefined, issue, preferLLM),
      isStateCorruptionIssue: issue => isStateCorruptionIssue(undefined, issue, preferLLM),
      log: (level, message, ...meta) => logger[level](message, ...meta),
    },
    fixPolicy: {
      planningConfig: getChapterPlanningConfig(state.genre),
      splitIntoParagraphs: () => [],
      findAffectedParagraphs: () => [],
      log: (level, message, ...meta) => logger[level](message, ...meta),
    },
    isStructuralIssue: issue => isStructuralIssue(undefined, issue, preferLLM),
    isLocalIssue: issue => isLocalIssue(undefined, issue, preferLLM),
    isTaskConsistencyIssue: issue => isTaskConsistencyIssue(undefined, issue, preferLLM),
  }

  const ctx: RoutingContext = {
    session,
    pendingIssues: state.pendingIssues,
    genre: state.genre,
    chapterFileExists,
  }

  const { step, sessionUpdate, processedIssues, newConstraints } = await decideNextStep(
    ctx,
    routingDeps
  )

  let routingDecision: RoutingDecision = 'finalize_chapter'
  switch (step.kind) {
    case 'draft':
      routingDecision = 'draft_chapter'
      break
    case 'fix':
      routingDecision = 'fix_chapter'
      break
    case 'finalize':
      routingDecision = 'finalize_chapter'
      break
    case 'request_rewrite':
      routingDecision = 'request_rewrite'
      break
  }

  const update = mergeSessionUpdate(session, {
    ...sessionUpdate,
    routingDecision,
    rewriteAttempts: session.rewriteAttempts + 1,
  })

  update.pendingIssues = processedIssues

  const currentVerifiedConstraints = state.verifiedConstraints ?? []
  const trimmedConstraints =
    currentVerifiedConstraints.length + newConstraints.length >
    getChapterPlanningConfig(state.genre).maxVerifiedConstraints
      ? [...currentVerifiedConstraints, ...newConstraints].slice(
          -getChapterPlanningConfig(state.genre).maxVerifiedConstraints
        )
      : [...currentVerifiedConstraints, ...newConstraints]
  update.verifiedConstraints = trimmedConstraints

  // Handle temporary replan on outline boundary conflicts
  let chapterPlan = state.chapterPlan
  if (chapterPlan && shouldForceTemporaryReplan(state.outline, state.currentChapterIndex)) {
    logger.info('[MuseFlow] 检测到跨章节大纲桥接冲突，将临时重新规划本章...')
    chapterPlan = null
  }

  if (step.kind === 'draft' && step.discardPlan) {
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

  return update
}

export function routeByDecision(state: ReducedGraphState): string {
  return state.session?.routingDecision ?? 'finalize_chapter'
}

export function routeAfterValidation(_state: ReducedGraphState): string {
  return 'converge_and_decide'
}

export function routeAfterFinalize(state: ReducedGraphState): string {
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

export async function downgradeInterpretiveErrors(
  issues: Issue[],
  _isInterpretiveIssue: (issue: Issue) => Promise<boolean>
): Promise<{ issues: Issue[]; downgraded: boolean }> {
  // 降级逻辑已迁移到 routing/rewrite-policy.ts，此处保留导出以兼容旧调用方
  return { issues, downgraded: false }
}

export { capNonErrorIssuesByType }
export { calculateIssueSetSimilarity, buildVerifiedConstraints } from '../../../core/chapter-generation/routing/index.js'
