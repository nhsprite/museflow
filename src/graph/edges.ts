import type { ReducedGraphState } from './state.js'

export function should_start_chapters(state: ReducedGraphState): string {
  if (state.rewriteRequested && !state.rewriteApproved) {
    return 'request_rewrite'
  }
  if (state.pendingIssues.length > 0) {
    return 'request_rewrite'
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
  return state.currentChapterIndex >= state.totalChapters - 1 ? 'finalize_story' : 'next_chapter'
}
