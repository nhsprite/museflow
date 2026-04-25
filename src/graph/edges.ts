import type { ReducedGraphState } from './state.js'

export function should_start_chapters(state: ReducedGraphState): string {
  if (state.rewriteRequested && !state.rewriteApproved) {
    return 'request_rewrite'
  }
  const errorIssues = state.pendingIssues.filter(i => i.severity === 'error')
  if (errorIssues.length > 0) {
    if (state.rewriteApproved) {
      return 'finalize_chapter'
    }
    return 'request_rewrite'
  }
  if (state.writeOneChapterOnly) {
    return 'finalize_chapter'
  }
  if (state.rewriteApproved) return 'draft_chapter'
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
