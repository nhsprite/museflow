import type { Issue, RetryStrategy } from '../types/agent.js'

/**
 * 基于结构化 issue 字段（type / dimension）推断修复策略。
 * 不读取 description 等自然语言内容。
 */
export function inferRetryStrategy(issue: Issue): RetryStrategy {
  if (issue.type === 'word_count') return 'fix'
  if (issue.type === 'outline_violation' || issue.type === 'outline_deviation') return 'draft'
  if (issue.dimension === 'quality') return 'fix'
  if (issue.dimension === 'foreshadowing') return 'draft'
  if (issue.dimension === 'outline') return 'draft'
  if (issue.dimension === 'character_knowledge' || issue.dimension === 'dialogue') return 'draft'
  if (issue.type === 'state_corruption') return 'manual'
  return 'draft'
}
