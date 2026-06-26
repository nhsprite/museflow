import { logger } from '../utils/logger.js'
import type { ReducedGraphState } from './state.js'

export function should_start_chapters(state: ReducedGraphState): string {
  if (state.rewriteRequested && !state.rewriteApproved) {
    return 'request_rewrite'
  }
  // Check rewriteApproved BEFORE writeOneChapterOnly so that rewrites always proceed
  if (state.rewriteApproved) return 'draft_chapter'
  const errorIssues = state.pendingIssues.filter(i => i.severity === 'error')
  if (errorIssues.length > 0) {
    if (state.writeOneChapterOnly) {
      return 'finalize_chapter'
    }
    return 'request_rewrite'
  }

  const attempts = state.autoFixAttempts || 0

  if (attempts >= 3 && state.pendingIssues.length > 0) {
    logger.error(`[MuseFlow] 自动修复 ${attempts} 次后仍有 ${state.pendingIssues.length} 个警告未解决，需要手动重写`)
    if (state.writeOneChapterOnly) {
      return 'finalize_chapter'
    }
    return 'request_rewrite'
  }

  if (attempts > 0 && attempts < 3) {
    return 'revalidate'
  }

  if (state.writeOneChapterOnly) {
    return 'finalize_chapter'
  }
  if (state.currentChapterIndex < state.totalChapters - 1) {
    return 'next_chapter'
  }
  return 'finalize_story'
}

export function after_user_confirmation(state: ReducedGraphState): string {
  if (state.rewriteApproved) {
    return 'draft_chapter'
  }
  return 'finalize_chapter'
}

export function is_last_chapter(state: ReducedGraphState): string {
  if (state.writeOneChapterOnly) {
    return 'finalize_story'
  }
  return state.currentChapterIndex >= state.totalChapters - 1 ? 'finalize_story' : 'next_chapter'
}
