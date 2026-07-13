import type { Issue } from '../../../types/agent.js'
import type { ChapterSession } from './types.js'
import { isStructuralIssue, isLocalIssue, isTaskConsistencyIssue } from '../issue-classifier.js'

export type RepairApproach = { kind: 'draft'; discardPlan: boolean } | { kind: 'fix' }

export interface IssueClassificationSummary {
  hasStructural: boolean
  hasLocal: boolean
  hasTaskConsistency: boolean
}

export async function classifyIssues(issues: Issue[]): Promise<IssueClassificationSummary> {
  const errorIssues = issues.filter((i) => i.severity === 'error')
  if (errorIssues.length === 0) {
    return { hasStructural: false, hasLocal: false, hasTaskConsistency: false }
  }

  const [structuralFlags, localFlags, taskFlags] = await Promise.all([
    Promise.all(errorIssues.map((i) => isStructuralIssue(i))),
    Promise.all(errorIssues.map((i) => isLocalIssue(i))),
    Promise.all(errorIssues.map((i) => isTaskConsistencyIssue(i))),
  ])

  return {
    hasStructural: structuralFlags.some(Boolean),
    hasLocal: localFlags.some(Boolean),
    hasTaskConsistency: taskFlags.some(Boolean),
  }
}

export function decideRepairApproach(
  session: ChapterSession,
  summary: IssueClassificationSummary,
  chapterFileExists: boolean,
  log?: (level: 'info' | 'warn' | 'error', message: string, ...meta: unknown[]) => void
): RepairApproach {
  if (!chapterFileExists) {
    log?.(
      'info',
      `[MuseFlow] 第 ${session.chapterIndex + 1} 章文件不存在，跳过修复模式，直接重新起草...`
    )
    return { kind: 'draft', discardPlan: false }
  }

  if (summary.hasTaskConsistency) {
    log?.('info', '[MuseFlow] 检测到跨章节差事一致性错误，将清空计划并重新规划...')
    return { kind: 'draft', discardPlan: true }
  }

  if (summary.hasStructural && !summary.hasLocal) {
    log?.('info', '[MuseFlow] 检测到结构性问题，将重新规划并完整重写本章...')
    return { kind: 'draft', discardPlan: true }
  }

  if (!summary.hasStructural && summary.hasLocal) {
    log?.('info', '[MuseFlow] 检测到局部问题，将使用段落修复模式...')
    return { kind: 'fix' }
  }

  if (summary.hasStructural) {
    log?.('info', '[MuseFlow] 同时存在结构性和局部问题，将重新规划并完整重写...')
    return { kind: 'draft', discardPlan: true }
  }

  log?.('info', '[MuseFlow] 检测到局部问题，将使用现有计划重写...')
  return { kind: 'draft', discardPlan: false }
}
