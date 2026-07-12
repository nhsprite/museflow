import { describe, expect, it } from 'vitest'
import { prepareChapter } from '../../../../src/graph/services/chapter-orchestration/preparation.js'
import type { ReducedGraphState } from '../../../../src/graph/state.js'
import type { ChapterSession } from '../../../../src/core/chapter-generation/routing/types.js'
import type { Issue } from '../../../../src/types/agent.js'

function makeSession(overrides: Partial<ChapterSession> = {}): ChapterSession {
  return {
    chapterIndex: 1,
    rewriteAttempts: 3,
    errorRewriteAttempts: 2,
    autoFixAttempts: 1,
    previousIssues: [],
    previousRawErrorCount: 0,
    routingDecision: 'fix_chapter',
    forceStructuralRewrite: true,
    rewriteApproved: true,
    issueFingerprintHistory: [['fp-a'], ['fp-b']],
    ...overrides,
  }
}

function makeState(overrides: {
  currentChapterIndex?: number
  session?: ChapterSession
  pendingIssues?: Issue[]
}): ReducedGraphState {
  return {
    currentChapterIndex: overrides.currentChapterIndex ?? 1,
    session: overrides.session,
    pendingIssues: overrides.pendingIssues ?? [],
  } as unknown as ReducedGraphState
}

describe('prepareChapter', () => {
  it('preserves session on same-chapter rerun, including rewriteApproved and fingerprint history', async () => {
    const session = makeSession({ chapterIndex: 2, rewriteApproved: true })
    const state = makeState({ currentChapterIndex: 2, session })

    const result = await prepareChapter(state)

    expect(result.session).toBeUndefined()
    expect(result.pendingIssues).toBeUndefined()
  })

  it('initializes a fresh session when entering a new chapter', async () => {
    const session = makeSession({ chapterIndex: 1, rewriteApproved: true })
    const state = makeState({ currentChapterIndex: 2, session })

    const result = await prepareChapter(state)

    expect(result.session).toMatchObject({
      chapterIndex: 2,
      rewriteAttempts: 0,
      errorRewriteAttempts: 0,
      autoFixAttempts: 0,
      previousIssues: [],
      previousRawErrorCount: 0,
      routingDecision: undefined,
      forceStructuralRewrite: false,
      rewriteApproved: false,
      issueFingerprintHistory: [],
    })
  })

  it('initializes a session when none exists', async () => {
    const state = makeState({ currentChapterIndex: 3 })

    const result = await prepareChapter(state)

    expect(result.session).toMatchObject({
      chapterIndex: 3,
      rewriteApproved: false,
      issueFingerprintHistory: [],
    })
  })

  it('drops stale continuity/quality warnings but keeps errors and obligation issues on chapter change', async () => {
    const consistencyWarning: Issue = {
      id: 'w-consistency',
      type: 'consistency',
      severity: 'warning',
      description: '上一章的连续性警告',
      source: 'consistency',
    }
    const qualityWarning: Issue = {
      id: 'w-quality',
      type: 'consistency',
      severity: 'warning',
      description: '上一章的质量警告',
      dimension: 'quality',
      source: 'quality',
    }
    const consistencyError: Issue = {
      id: 'e-consistency',
      type: 'consistency',
      severity: 'error',
      description: '未解决的一致性错误',
      source: 'consistency',
    }
    const beatObligation: Issue = {
      id: 'unverified-beat-1-0',
      type: 'outline_coverage',
      severity: 'warning',
      description: 'mandatory beat 未验证',
      source: 'outline_compliance',
    }
    const foreshadowObligation: Issue = {
      id: 'foreshadow-boundary-unresolved-f1-1',
      type: 'foreshadow_boundary_unresolved',
      severity: 'warning',
      description: '伏笔未回收',
      source: 'foreshadowing',
    }
    const session = makeSession({ chapterIndex: 1 })
    const state = makeState({
      currentChapterIndex: 2,
      session,
      pendingIssues: [
        consistencyWarning,
        qualityWarning,
        consistencyError,
        beatObligation,
        foreshadowObligation,
      ],
    })

    const result = await prepareChapter(state)

    expect(result.pendingIssues?.map((i) => i.id)).toEqual([
      'e-consistency',
      'unverified-beat-1-0',
      'foreshadow-boundary-unresolved-f1-1',
    ])
  })
})
