import { describe, expect, it } from 'vitest'
import { should_start_chapters } from '../../src/graph/edges.js'
import type { ReducedGraphState } from '../../src/graph/state.js'

function createState(overrides: Partial<ReducedGraphState> = {}): ReducedGraphState {
  return {
    story: { id: 'story-1', title: 'Story', outputDir: '/tmp/story' },
    idea: 'idea',
    genre: 'default',
    totalChapters: 3,
    world: null,
    characters: [],
    outline: [],
    chapters: [null, null, null],
    currentChapterIndex: 0,
    foreshadowStack: [],
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: false,
    lastPrintedChapter: -1,
    lastTimelineSnapshot: null,
    chapterPlan: null,
    storyState: null,
    autoFixAttempts: 0,
    ...overrides,
  } as ReducedGraphState
}

describe('should_start_chapters edge function', () => {
  it('returns draft_chapter when rewrite is approved (regardless of writeOneChapterOnly)', () => {
    const state = createState({
      rewriteApproved: true,
      writeOneChapterOnly: true,
      pendingIssues: [],
    })
    expect(should_start_chapters(state)).toBe('draft_chapter')
  })

  it('returns draft_chapter when rewriteApproved is true with error issues', () => {
    const state = createState({
      rewriteApproved: true,
      writeOneChapterOnly: true,
      pendingIssues: [{ id: '1', severity: 'error' as const, message: 'test error', chapterIndex: 0 }],
    })
    expect(should_start_chapters(state)).toBe('draft_chapter')
  })

  it('returns request_rewrite when rewrite requested but not approved', () => {
    const state = createState({
      rewriteRequested: true,
      rewriteApproved: false,
    })
    expect(should_start_chapters(state)).toBe('request_rewrite')
  })

  it('returns finalize_chapter when writeOneChapterOnly is true and no rewrite', () => {
    const state = createState({
      writeOneChapterOnly: true,
      rewriteApproved: false,
      rewriteRequested: false,
      pendingIssues: [],
    })
    expect(should_start_chapters(state)).toBe('finalize_chapter')
  })

  it('returns finalize_story when last chapter is done', () => {
    const state = createState({
      currentChapterIndex: 2,
      totalChapters: 3,
      writeOneChapterOnly: false,
      rewriteApproved: false,
      rewriteRequested: false,
      pendingIssues: [],
    })
    expect(should_start_chapters(state)).toBe('finalize_story')
  })

  it('returns next_chapter when more chapters remain', () => {
    const state = createState({
      currentChapterIndex: 0,
      totalChapters: 3,
      writeOneChapterOnly: false,
      rewriteApproved: false,
      rewriteRequested: false,
      pendingIssues: [],
    })
    expect(should_start_chapters(state)).toBe('next_chapter')
  })

  it('returns request_rewrite when errors exist and rewrite is requested but not approved', () => {
    const state = createState({
      pendingIssues: [{ id: '1', severity: 'error' as const, message: 'test error', chapterIndex: 0 }],
      rewriteRequested: true,
      rewriteApproved: false,
    })
    expect(should_start_chapters(state)).toBe('request_rewrite')
  })

  it('returns finalize_chapter when errors exist and writeOneChapterOnly is true', () => {
    const state = createState({
      pendingIssues: [{ id: '1', severity: 'error' as const, message: 'test error', chapterIndex: 0 }],
      writeOneChapterOnly: true,
      rewriteApproved: false,
      rewriteRequested: false,
    })
    expect(should_start_chapters(state)).toBe('finalize_chapter')
  })

  it('returns revalidate when autoFixAttempts is 1', () => {
    const state = createState({
      autoFixAttempts: 1,
      pendingIssues: [],
    })
    expect(should_start_chapters(state)).toBe('revalidate')
  })

  it('returns revalidate when autoFixAttempts is 2', () => {
    const state = createState({
      autoFixAttempts: 2,
      pendingIssues: [],
    })
    expect(should_start_chapters(state)).toBe('revalidate')
  })

  it('proceeds normally when autoFixAttempts reaches 3', () => {
    const state = createState({
      autoFixAttempts: 3,
      pendingIssues: [],
      writeOneChapterOnly: false,
    })
    expect(should_start_chapters(state)).toBe('next_chapter')
  })

  it('proceeds normally when autoFixAttempts is 0', () => {
    const state = createState({
      autoFixAttempts: 0,
      pendingIssues: [],
      writeOneChapterOnly: false,
    })
    expect(should_start_chapters(state)).toBe('next_chapter')
  })

  it('returns request_rewrite when max attempts (3) reached and warnings remain', () => {
    const state = createState({
      autoFixAttempts: 3,
      pendingIssues: [
        { id: '1', type: 'hallucination', severity: 'warning' as const, description: 'test warning' },
      ],
      writeOneChapterOnly: false,
    })
    expect(should_start_chapters(state)).toBe('request_rewrite')
  })

  it('returns finalize_chapter when max attempts reached but writeOneChapterOnly is true', () => {
    const state = createState({
      autoFixAttempts: 3,
      pendingIssues: [
        { id: '1', type: 'hallucination', severity: 'warning' as const, description: 'test warning' },
      ],
      writeOneChapterOnly: true,
    })
    expect(should_start_chapters(state)).toBe('finalize_chapter')
  })
})