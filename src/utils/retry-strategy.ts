import type { Issue, RetryStrategy } from '../types/agent.js'

/**
 * 基于结构化 issue 字段（type / dimension）推断修复策略。
 * 不读取 description 等自然语言内容。
 */
export function inferRetryStrategy(issue: Issue): RetryStrategy {
  if (issue.type === 'word_count') return 'fix'
  if (issue.type === 'outline_violation' || issue.type === 'outline_deviation') return 'draft'
  if (issue.type === 'state_corruption') return 'manual'
  if (issue.type === 'outline_coverage') return 'manual'
  if (issue.type === 'foreshadow_boundary_unresolved') return 'draft'
  if (issue.type === 'foreshadow_false_fulfillment') return 'draft'

  if (issue.dimension === 'quality') return 'fix'
  if (issue.dimension === 'pace') return 'fix'
  // 普通伏笔回收描写不足可以局部修复；结构性违约已由上方 type 分支处理。
  if (issue.dimension === 'foreshadowing') return 'fix'
  if (issue.dimension === 'outline') return 'draft'
  if (
    issue.dimension === 'character_knowledge' ||
    issue.dimension === 'dialogue' ||
    issue.dimension === 'information'
  ) {
    // 如果一致性错误已经精确定位到段落/句子，优先走局部 fix，避免整章重打。
    return issue.locationRef?.paragraphIndex !== undefined ? 'fix' : 'draft'
  }
  return 'draft'
}
