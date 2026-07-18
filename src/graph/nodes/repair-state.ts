import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type { RuntimeContext } from '../../core/context.js'
import { createEmptyStoryState } from '../../storage/meta/stores/story-state.js'
import { classifyIssueByRule } from '../../core/chapter-generation/issue-classifier.js'
import { repairCorruptedState } from '../services/state-repair/index.js'
import { selectChapterSummaries } from '../../utils/chapter-summaries.js'
import { generateIssueFingerprint } from '../../utils/context-judge.js'

/**
 * 自动状态修复节点：rewrite 循环中剩余 error 包含状态污染类问题且本章修复
 * 尝试次数未耗尽时由 routing 进入（每章最多 2 次）。LLM 提出结构化状态修正
 * 提案，经严格结构化校验后写入 canonicalFacts（source: 'state_repair'）并
 * 立即合并进 storyState，随后出边进入 validate_chapter_structured 重新校验。
 *
 * 被校验拒绝的提案原因会写回 session.stateRepairRejections，在下一次修复
 * 尝试时回传给 LLM，避免原样重复提案；尝试次数耗尽后 routing 退回人工
 * request_rewrite。
 */
export async function repair_state(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const chapterIndex = state.currentChapterIndex

  const stateCorruptionIssues = state.pendingIssues.filter(
    (issue) => issue.severity === 'error' && classifyIssueByRule(issue).isStateCorruption
  )
  if (stateCorruptionIssues.length === 0) {
    logger.info('[MuseFlow] 无状态污染类问题，跳过状态修复')
    return {}
  }

  logger.info(
    `[MuseFlow] 第 ${chapterIndex + 1} 章检测到 ${stateCorruptionIssues.length} 个状态污染类错误，尝试自动状态修复...`
  )

  const outcome = await repairCorruptedState(
    {
      issues: stateCorruptionIssues,
      storyState: state.storyState ?? createEmptyStoryState(),
      storyMemory: state.storyMemory,
      chapterSummaries: selectChapterSummaries(state.chapters, chapterIndex),
      currentChapterIndex: chapterIndex,
      ...(state.session?.stateRepairRejections && state.session.stateRepairRejections.length > 0
        ? { previousRejections: state.session.stateRepairRejections }
        : {}),
    },
    context.provider
  )

  // 把本轮被拒原因写回 session，供下一次修复尝试回传给 LLM。
  const sessionUpdate: Partial<ReducedGraphState> = state.session
    ? {
        session: {
          ...state.session,
          stateRepairRejections: outcome.rejectionFeedback,
        },
      }
    : {}

  if (outcome.acceptedFacts.length === 0) {
    return sessionUpdate
  }

  // 已修复的状态污染类 issue 从 pendingIssues 移除；重校验后若问题仍在，
  // 检测器会以同一结构化规则指纹重新报告。
  const repairedIssueFingerprints = new Set(stateCorruptionIssues.map(generateIssueFingerprint))

  return {
    ...sessionUpdate,
    storyState: outcome.storyState,
    canonicalFactsDelta: [...(state.canonicalFactsDelta ?? []), ...outcome.acceptedFacts],
    pendingIssues: state.pendingIssues.filter(
      (issue) => !repairedIssueFingerprints.has(generateIssueFingerprint(issue))
    ),
  }
}
