import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type { RuntimeContext } from '../../core/context.js'
import { createEmptyStoryState } from '../../storage/meta/stores/story-state.js'
import { classifyIssueByRule } from '../../core/chapter-generation/issue-classifier.js'
import { repairCorruptedState } from '../services/state-repair/index.js'

/**
 * 自动状态修复节点：rewrite 循环中剩余 error 全部为状态污染类且本章尚未
 * 尝试过修复时由 routing 进入。LLM 提出结构化状态修正提案，经严格结构化
 * 校验后写入 canonicalFacts（source: 'state_repair'）并立即合并进 storyState，
 * 随后出边进入 validate_chapter_structured 重新校验。
 *
 * 无任何提案通过校验时不改状态：routing 下轮会因 stateRepairAttempted=true
 * 退回人工 request_rewrite。
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
      chapterSummaries: state.chapterSummaries,
      currentChapterIndex: chapterIndex,
    },
    context.provider
  )

  if (outcome.acceptedFacts.length === 0) {
    return {}
  }

  // 已修复的状态污染类 issue 从 pendingIssues 移除，避免旧 issue 残留；
  // 重校验后若问题仍在，检测器会以新 id 重新报告。
  const repairedIssueIds = new Set(stateCorruptionIssues.map((issue) => issue.id))

  return {
    storyState: outcome.storyState,
    canonicalFactsDelta: [...(state.canonicalFactsDelta ?? []), ...outcome.acceptedFacts],
    pendingIssues: state.pendingIssues.filter((issue) => !repairedIssueIds.has(issue.id)),
  }
}
