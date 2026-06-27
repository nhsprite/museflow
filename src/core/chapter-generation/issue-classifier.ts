import type { Issue } from '../../types/agent.js'

const STRUCTURAL_ISSUE_TYPES = new Set([
  'outline_violation',
  'timeline_mismatch',
  'logic_issue',
])

const CROSS_CHAPTER_MARKERS = [
  /上一章/,
  /前[一二三四五六七八九十\d]+章/,
  /第\s*[一二三四五六七八九十\d]+\s*章/,
  /story_state/,
  /已确认事实/,
  /已确立/,
  /既定事实/,
  /大纲第\s*[一二三四五六七八九十\d]+\s*章/,
]

const PENDING_TASK_MARKERS = [
  /未执行.*差事/,
  /未领受.*差事/,
  /无故搁置/,
  /已确立的差事/,
  /未出现.*差事/,
]

export function isInventedCharacterIssue(issue: Issue): boolean {
  const text = `${issue.description} ${issue.location ?? ''}`
  return /invent|虚构|编造|未在角色|不在官方角色|非官方角色|新角色/.test(text)
}

export function isItemLocationConflictIssue(issue: Issue): boolean {
  const text = `${issue.description} ${issue.location ?? ''}`
  return /位置矛盾|位置冲突|物品位置|storyState|关键物品.*矛盾/.test(text)
}

export function isOutlineStateConflictIssue(issue: Issue): boolean {
  if (issue.type !== 'consistency' && issue.type !== 'hallucination') return false
  const text = `${issue.description} ${issue.location ?? ''}`
  return /大纲.*矛盾|大纲.*冲突|与大纲.*不符|outline.*conflict|canonical.*fact|权威事实|superseded|已被覆盖|大纲.*状态/.test(text)
}

export function isCrossChapterKnowledgeIssue(issue: Issue): boolean {
  if (issue.type !== 'consistency') return false
  const text = `${issue.description} ${issue.location ?? ''}`
  return /角色.*前章.*知道|本章.*像第一次|前章.*已知|知识矛盾|已知信息|认知.*矛盾/.test(text)
}

export function isTaskConsistencyIssue(issue: Issue): boolean {
  return issue.type === 'consistency' &&
    PENDING_TASK_MARKERS.some(pattern => pattern.test(issue.description))
}

export function isStructuralIssue(issue: Issue): boolean {
  if (STRUCTURAL_ISSUE_TYPES.has(issue.type)) {
    return true
  }

  if (issue.type === 'outline_deviation') {
    const text = `${issue.description} ${issue.location || ''}`
    return /缺少|完全缺失|核心事件|严重偏离|完全忽略|未出现/.test(text)
  }

  if (issue.type === 'consistency' || issue.type === 'hallucination') {
    const text = `${issue.description} ${issue.location || ''}`
    if (CROSS_CHAPTER_MARKERS.some(pattern => pattern.test(text))) {
      return true
    }
  }

  return false
}

export function isLocalIssue(issue: Issue): boolean {
  return issue.severity === 'error' && !isStructuralIssue(issue)
}

export function isStateCorruptionIssue(issue: Issue): boolean {
  return (
    isItemLocationConflictIssue(issue) ||
    isInventedCharacterIssue(issue) ||
    isOutlineStateConflictIssue(issue)
  )
}
