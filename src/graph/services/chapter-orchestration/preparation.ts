import type { ReducedGraphState } from '../../state.js'
import type { Issue } from '../../../types/agent.js'
import { createChapterSession } from '../../../core/chapter-generation/routing/session.js'
import type { ModelProvider } from '../../../model/provider.js'
import { reconcileForeshadowEquivalence } from '../foreshadow-equivalence/reconcile.js'
import { projectForeshadowStack } from '../../../story-memory/foreshadow-policy.js'
import { rebuildStoryMemoryVerifiedConstraints } from '../../../utils/story-memory-constraints.js'
import { logger } from '../../../utils/logger.js'

/**
 * 进入新章节时丢弃上一章残留的连续性/质量类 warning。
 * 这类 warning 针对上一章正文，带入新章节会污染 planner 的 issuesSection。
 * error 以及义务类 issue（beat/伏笔等，带确定性 id 与其他 source）必须保留。
 */
function pruneStaleChapterWarnings(issues: Issue[]): Issue[] {
  return issues.filter((issue) => {
    if (issue.severity === 'error') return true
    return issue.source !== 'consistency' && issue.source !== 'quality'
  })
}

export async function prepareChapter(
  state: ReducedGraphState,
  provider: ModelProvider
): Promise<Partial<ReducedGraphState>> {
  const existingSession = state.session
  if (!state.storyMemory) {
    if (existingSession && existingSession.chapterIndex === state.currentChapterIndex) {
      return {}
    }

    return {
      session: createChapterSession(state.currentChapterIndex),
      pendingIssues: pruneStaleChapterWarnings(state.pendingIssues),
    }
  }

  const reconciled = await reconcileForeshadowEquivalence({
    provider,
    memory: state.storyMemory,
    chapterIndex: state.currentChapterIndex,
    ...(state.foreshadowEquivalenceAudit !== undefined
      ? { audit: state.foreshadowEquivalenceAudit }
      : {}),
  })
  const reconciledStack = projectForeshadowStack(reconciled.memory)
  const verifiedConstraints = rebuildStoryMemoryVerifiedConstraints({
    existingConstraints: state.verifiedConstraints,
    memory: reconciled.memory,
    foreshadowStack: reconciledStack,
    foreshadowStackSource: 'canonical_memory',
    currentChapter: state.currentChapterIndex + 1,
  })
  const reconciliationUpdate: Partial<ReducedGraphState> = {
    storyMemory: reconciled.memory,
    foreshadowStack: reconciledStack,
    verifiedConstraints,
    foreshadowEquivalenceAudit: reconciled.audit,
  }
  for (const event of reconciled.mergeEvents) {
    logger.info(
      `[MuseFlow] 伏笔等价合并 ${event.duplicateForeshadowId} -> ${event.canonicalForeshadowId}`
    )
  }
  logger.info(
    `[MuseFlow] 伏笔等价审计：活跃规范义务 ${reconciled.activeCanonicalCountBeforeMerge} -> ${reconciled.audit.activeCanonicalIds.length}`
  )

  // 同章重跑（rewrite 循环或 checkpoint 恢复）时保留 session，
  // 尤其是 rewriteApproved 与 issueFingerprintHistory，供停滞检测与收敛升级使用。
  if (existingSession && existingSession.chapterIndex === state.currentChapterIndex) {
    return reconciliationUpdate
  }

  const freshSession = createChapterSession(state.currentChapterIndex)
  return {
    ...reconciliationUpdate,
    session: freshSession,
    pendingIssues: pruneStaleChapterWarnings(state.pendingIssues),
  }
}
