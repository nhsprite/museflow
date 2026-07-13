import type { ChapterSession } from './types.js'

/**
 * 创建新的 ChapterSession，所有计数器/历史初始化为默认值。
 * 可通过 overrides 覆盖特定字段。
 */
export function createChapterSession(
  chapterIndex: number,
  overrides: Partial<ChapterSession> = {}
): ChapterSession {
  return {
    chapterIndex,
    rewriteAttempts: 0,
    errorRewriteAttempts: 0,
    autoFixAttempts: 0,
    previousIssues: [],
    previousRawErrorCount: 0,
    routingDecision: undefined,
    forceStructuralRewrite: false,
    rewriteApproved: false,
    issueFingerprintHistory: [],
    stateRepairAttempted: false,
    ...overrides,
  }
}
