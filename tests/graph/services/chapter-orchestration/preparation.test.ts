import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareChapter } from '../../../../src/graph/services/chapter-orchestration/preparation.js'
import {
  FORESHADOW_EQUIVALENCE_AUDIT_PROTOCOL_VERSION,
  type ReducedGraphState,
} from '../../../../src/graph/state.js'
import type { ChapterSession } from '../../../../src/core/chapter-generation/routing/types.js'
import type { Issue } from '../../../../src/types/agent.js'
import type { ModelProvider } from '../../../../src/model/provider.js'
import { applyEvents, createEmptyStoryMemory } from '../../../../src/story-memory/projector.js'
import type { StoryEvent, StoryMemory } from '../../../../src/types/story-memory.js'
import { ForeshadowEquivalenceError } from '../../../../src/graph/services/foreshadow-equivalence/detector.js'
import { logger } from '../../../../src/utils/logger.js'

vi.mock('../../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

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

function makeState(
  overrides: Partial<ReducedGraphState> & {
    currentChapterIndex?: number
    session?: ChapterSession
    pendingIssues?: Issue[]
  }
): ReducedGraphState {
  return {
    currentChapterIndex: overrides.currentChapterIndex ?? 1,
    session: overrides.session,
    pendingIssues: overrides.pendingIssues ?? [],
    foreshadowStack: overrides.foreshadowStack ?? [],
    verifiedConstraints: overrides.verifiedConstraints ?? [],
    storyMemory: overrides.storyMemory ?? null,
    foreshadowEquivalenceAudit: overrides.foreshadowEquivalenceAudit,
  } as unknown as ReducedGraphState
}

function createProvider(groups: unknown[] = []): ModelProvider {
  return {
    chat: vi.fn(),
    chatStructured: vi.fn().mockResolvedValue({ groups }),
  }
}

function duplicateMemory(): StoryMemory {
  const events: StoryEvent[] = [
    {
      id: 'introduce-a',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-a',
      text: 'first record',
      expectedFulfillChapter: 6,
      resolutionPolicy: 'must_resolve',
      chapterIndex: 0,
      source: 'outline',
    },
    {
      id: 'introduce-b',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-b',
      text: 'duplicate record',
      expectedFulfillChapter: 6,
      resolutionPolicy: 'must_resolve',
      chapterIndex: 1,
      source: 'outline',
    },
  ]
  return applyEvents(createEmptyStoryMemory(), events)
}

describe('prepareChapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves session on same-chapter rerun, including rewriteApproved and fingerprint history', async () => {
    const session = makeSession({ chapterIndex: 2, rewriteApproved: true })
    const state = makeState({ currentChapterIndex: 2, session })

    const result = await prepareChapter(state, createProvider())

    expect(result.session).toBeUndefined()
    expect(result.pendingIssues).toBeUndefined()
  })

  it('initializes a fresh session when entering a new chapter', async () => {
    const session = makeSession({ chapterIndex: 1, rewriteApproved: true })
    const state = makeState({ currentChapterIndex: 2, session })

    const result = await prepareChapter(state, createProvider())

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

    const result = await prepareChapter(state, createProvider())

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

    const result = await prepareChapter(state, createProvider())

    expect(result.pendingIssues?.map((i) => i.id)).toEqual([
      'e-consistency',
      'unverified-beat-1-0',
      'foreshadow-boundary-unresolved-f1-1',
    ])
  })

  it('reconciles historical duplicates and rebuilds canonical planning inputs before session creation', async () => {
    const memory = duplicateMemory()
    const provider = createProvider([
      { ids: ['fs-b', 'fs-a'], reason: 'same unresolved obligation' },
    ])
    const state = makeState({
      currentChapterIndex: 2,
      session: makeSession({ chapterIndex: 1 }),
      storyMemory: memory,
      verifiedConstraints: [
        { kind: 'generic', id: 'memory:foreshadow:fs-b', text: 'stale duplicate' },
        { kind: 'generic', id: 'manual:keep', text: 'manual constraint' },
      ],
    })

    const result = await prepareChapter(state, provider)

    expect(result.session?.chapterIndex).toBe(2)
    expect(result.storyMemory?.foreshadows['fs-b']?.mergedInto).toBe('fs-a')
    expect(result.foreshadowStack?.map((entry) => entry.id)).toEqual(['fs-a'])
    expect(result.foreshadowEquivalenceAudit).toEqual({
      protocolVersion: FORESHADOW_EQUIVALENCE_AUDIT_PROTOCOL_VERSION,
      activeCanonicalIds: ['fs-a'],
    })
    expect(
      result.verifiedConstraints?.filter(
        (entry) => entry.kind === 'generic' && entry.id === 'memory:foreshadow:fs-a'
      )
    ).toHaveLength(1)
    expect(
      result.verifiedConstraints?.some(
        (entry) => entry.kind === 'generic' && entry.id === 'memory:foreshadow:fs-b'
      )
    ).toBe(false)
    expect(
      result.verifiedConstraints?.some(
        (entry) => entry.kind === 'generic' && entry.id === 'manual:keep'
      )
    ).toBe(true)
    expect(vi.mocked(logger.info).mock.calls).toEqual([
      ['[MuseFlow] 伏笔等价合并 fs-b -> fs-a：same unresolved obligation'],
      ['[MuseFlow] 伏笔等价审计：活跃规范义务 2 -> 1'],
    ])
  })

  it('still reconciles and returns planning inputs on a same-chapter rerun', async () => {
    const session = makeSession({ chapterIndex: 2 })
    const provider = createProvider([
      { ids: ['fs-a', 'fs-b'], reason: 'same unresolved obligation' },
    ])
    const state = makeState({
      currentChapterIndex: 2,
      session,
      storyMemory: duplicateMemory(),
    })

    const result = await prepareChapter(state, provider)

    expect(result.session).toBeUndefined()
    expect(result.pendingIssues).toBeUndefined()
    expect(result.storyMemory?.foreshadows['fs-b']?.mergedInto).toBe('fs-a')
    expect(result.foreshadowStack?.map((entry) => entry.id)).toEqual(['fs-a'])
    expect(result.verifiedConstraints).toBeDefined()
    expect(result.foreshadowEquivalenceAudit?.activeCanonicalIds).toEqual(['fs-a'])
  })

  it('uses a matching audit to skip the provider', async () => {
    const memory = duplicateMemory()
    const provider = createProvider()
    const state = makeState({
      currentChapterIndex: 2,
      storyMemory: memory,
      foreshadowEquivalenceAudit: {
        protocolVersion: FORESHADOW_EQUIVALENCE_AUDIT_PROTOCOL_VERSION,
        activeCanonicalIds: ['fs-a', 'fs-b'],
      },
    })

    const result = await prepareChapter(state, provider)

    expect(result.storyMemory).toBe(memory)
    expect(provider.chatStructured).not.toHaveBeenCalled()
  })

  it('invalidates the audit when the active canonical set changes', async () => {
    const provider = createProvider()
    const state = makeState({
      currentChapterIndex: 2,
      storyMemory: duplicateMemory(),
      foreshadowEquivalenceAudit: {
        protocolVersion: FORESHADOW_EQUIVALENCE_AUDIT_PROTOCOL_VERSION,
        activeCanonicalIds: ['fs-a'],
      },
    })

    await prepareChapter(state, provider)

    expect(provider.chatStructured).toHaveBeenCalledTimes(1)
  })

  it('does not mutate state or return a partial update when reconciliation fails', async () => {
    const memory = duplicateMemory()
    const state = makeState({
      currentChapterIndex: 2,
      session: makeSession({ chapterIndex: 1 }),
      storyMemory: memory,
      foreshadowEquivalenceAudit: {
        protocolVersion: FORESHADOW_EQUIVALENCE_AUDIT_PROTOCOL_VERSION,
        activeCanonicalIds: ['stale'],
      },
    })
    const snapshot = structuredClone(state)
    const provider = createProvider([{ ids: ['fs-a', 'unknown'], reason: 'invalid' }])

    await expect(prepareChapter(state, provider)).rejects.toBeInstanceOf(ForeshadowEquivalenceError)
    expect(state).toEqual(snapshot)
  })

  it('preserves legacy null-memory behavior without calling the provider', async () => {
    const provider = createProvider()
    const state = makeState({ currentChapterIndex: 3 })

    const result = await prepareChapter(state, provider)

    expect(result.session?.chapterIndex).toBe(3)
    expect(result.storyMemory).toBeUndefined()
    expect(result.foreshadowEquivalenceAudit).toBeUndefined()
    expect(provider.chatStructured).not.toHaveBeenCalled()
    expect(provider.chat).not.toHaveBeenCalled()
  })
})
