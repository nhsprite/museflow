import type { ReducedGraphState } from '../../state.js'
import type { Issue } from '../../../types/agent.js'
import { createChapterSession } from '../../../core/chapter-generation/routing/session.js'

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
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const existingSession = state.session
  // 同章重跑（rewrite 循环或 checkpoint 恢复）时保留 session，
  // 尤其是 rewriteApproved 与 issueFingerprintHistory，供停滞检测与收敛升级使用。
  if (existingSession && existingSession.chapterIndex === state.currentChapterIndex) {
    return {}
  }

  const freshSession = createChapterSession(state.currentChapterIndex)
  return {
    session: freshSession,
    pendingIssues: pruneStaleChapterWarnings(state.pendingIssues),
  }
}
