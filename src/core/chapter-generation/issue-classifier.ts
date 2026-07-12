import type { Issue } from '../../types/agent.js'

export interface IssueClassification {
  isStructural: boolean
  isCrossChapter: boolean
  isTaskConsistency: boolean
  isItemLocationConflict: boolean
  isInventedCharacter: boolean
  isOutlineStateConflict: boolean
  isLocal: boolean
  isStateCorruption: boolean
  isInterpretive: boolean
}

function issueDimensionIs(issue: Issue, dimension: string): boolean {
  return issue.dimension === dimension
}

/**
 * 基于结构化 issue 字段做确定性分类。
 * 不读取 description/location/suggestion 的自然语言内容。
 */
export function classifyIssueByRule(issue: Issue): IssueClassification {
  const isError = issue.severity === 'error'

  const isItemLocationConflict = issueDimensionIs(issue, 'item_location')
  const isInventedCharacter = issueDimensionIs(issue, 'invented_character')
  const isOutlineStateConflict = issueDimensionIs(issue, 'outline_state_conflict')
  const isTaskConsistency =
    issueDimensionIs(issue, 'task_consistency') || issue.type === 'outline_invalid_deadline'

  // structured_state / space 维度的一致性问题通常是状态记录（位置/持有者等
  // 结构化字段）与已定稿章节正文矛盾，改正文无法解决，按状态污染处理。
  const isStructuredStateConflict =
    issueDimensionIs(issue, 'structured_state') || issueDimensionIs(issue, 'space')

  const isStateCorruption =
    issue.type === 'state_corruption' ||
    issueDimensionIs(issue, 'state_corruption') ||
    isItemLocationConflict ||
    isInventedCharacter ||
    isOutlineStateConflict ||
    isStructuredStateConflict

  const isStructuralType =
    issue.type === 'outline_violation' ||
    issue.type === 'outline_deviation' ||
    issue.type === 'draft_failure' ||
    issue.type === 'state_corruption' ||
    issue.type === 'word_count' ||
    issue.type === 'outline_density' ||
    issue.type === 'outline_foreshadow'

  const isCrossChapter = issue.type === 'consistency' || isTaskConsistency

  const isInterpretive = !isStateCorruption && issueDimensionIs(issue, 'quality')

  const isStructural =
    isStructuralType ||
    isStateCorruption ||
    (isError && issue.type === 'consistency' && issue.dimension !== 'quality')

  const isLocal = isError && !isStructural

  return {
    isStructural,
    isCrossChapter,
    isTaskConsistency,
    isItemLocationConflict,
    isInventedCharacter,
    isOutlineStateConflict,
    isLocal,
    isStateCorruption,
    isInterpretive,
  }
}

export function isTaskConsistencyIssue(issue: Issue): boolean {
  return classifyIssueByRule(issue).isTaskConsistency
}

export function isStructuralIssue(issue: Issue): boolean {
  return classifyIssueByRule(issue).isStructural
}

export function isLocalIssue(issue: Issue): boolean {
  return classifyIssueByRule(issue).isLocal
}

export function isStateCorruptionIssue(issue: Issue): boolean {
  return classifyIssueByRule(issue).isStateCorruption
}

export function isInterpretiveIssue(issue: Issue): boolean {
  return classifyIssueByRule(issue).isInterpretive
}
