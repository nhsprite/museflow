import type { ReducedGraphState } from './state.js'

export async function build_world(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return { world: null }
}

export async function create_characters(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return { characters: [] }
}

export async function create_outline(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return { outline: [] }
}

export async function draft_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return { chapters: state.chapters }
}

export async function quality_pass(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return { chapters: state.chapters }
}

export async function detect_foreshadowing(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return { foreshadowStack: state.foreshadowStack }
}

export async function detect_hallucination(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return { pendingIssues: [] }
}

export async function detect_consistency(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return { pendingIssues: [] }
}

export async function request_rewrite(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return { rewriteRequested: true }
}

export async function finalize_chapter(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const nextIndex = state.currentChapterIndex + 1
  return {
    currentChapterIndex: nextIndex,
    pendingIssues: [],
    rewriteRequested: false,
    rewriteApproved: false,
  }
}

export async function finalize_story(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  return {}
}
