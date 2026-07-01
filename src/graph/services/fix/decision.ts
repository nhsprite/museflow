import type { Issue } from '../../../types/agent.js'

export interface FixModeDecision {
  mode: 'skip' | 'sentence' | 'paragraph' | 'legacy'
  reason: string
}

export function hasPatchableIssues(issues: Issue[]): boolean {
  return issues.some(issue => {
    if (issue.severity !== 'warning') return true
    if (issue.type === 'consistency' && issue.dimension !== 'quality') return true
    if (issue.type === 'consistency' && issue.dimension === 'quality' && issue.location) {
      return /第\s*\d+\s*[段节]|段落\s*\d+|第\s*\d+\s*句/.test(issue.location)
    }
    return false
  })
}

export function determineFixMode(
  paragraphs: string[],
  affectedIndices: number[],
  pendingIssues: Issue[]
): FixModeDecision {
  if (affectedIndices.length === 0) {
    return { mode: 'legacy', reason: '未能定位到问题所在段落，将使用全文修复模式' }
  }

  const hasErrors = pendingIssues.some(i => i.severity === 'error')
  const AFFECTED_PARAGRAPH_RATIO_THRESHOLD = hasErrors ? 0.4 : 0.65
  const AFFECTED_PARAGRAPH_ABSOLUTE_THRESHOLD = hasErrors ? 20 : 35
  const isConsistencyOrHallucination = pendingIssues.every(
    i => i.type === 'consistency' && i.dimension !== 'quality'
  )
  const affectedRatio = paragraphs.length > 0 ? affectedIndices.length / paragraphs.length : 0

  if (
    !isConsistencyOrHallucination &&
    (affectedIndices.length > AFFECTED_PARAGRAPH_ABSOLUTE_THRESHOLD || affectedRatio > AFFECTED_PARAGRAPH_RATIO_THRESHOLD)
  ) {
    return {
      mode: 'legacy',
      reason: `问题涉及 ${affectedIndices.length}/${paragraphs.length} 个段落（占比 ${Math.round(affectedRatio * 100)}%），超过修复阈值，转为完整重写`,
    }
  }

  return { mode: 'paragraph', reason: `定位到 ${affectedIndices.length} 个需修改的段落，使用段落级修复` }
}
