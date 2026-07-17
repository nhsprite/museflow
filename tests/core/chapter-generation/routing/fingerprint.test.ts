import { describe, expect, it } from 'vitest'
import {
  calculateFingerprintSetSimilarity,
  isFingerprintSubset,
} from '../../../../src/core/chapter-generation/routing/fingerprint.js'
import { decideNextStep } from '../../../../src/core/chapter-generation/routing/index.js'
import { generateIssueFingerprint } from '../../../../src/utils/context-judge.js'
import type {
  RoutingContext,
  RoutingDeps,
} from '../../../../src/core/chapter-generation/routing/types.js'
import type { Issue } from '../../../../src/types/agent.js'
import type { ChapterPlanningConfig } from '../../../../src/types/genre.js'
import { DEFAULT_CHAPTER_PLANNING_CONFIG } from '../../../../src/utils/chapter-planning.js'

const planningConfig: ChapterPlanningConfig = {
  ...DEFAULT_CHAPTER_PLANNING_CONFIG,
  maxErrorRewriteAttempts: 5,
  downgradeInterpretiveErrors: false,
}

function makeIssue(subject: string): Issue {
  return {
    id: `issue-${subject}`,
    ruleId: 'consistency.character-state',
    type: 'consistency',
    severity: 'error',
    description: `角色 ${subject} 状态不一致`,
    subject,
    dimension: 'continuity',
    source: 'consistency',
  }
}

function fingerprints(subjects: string[]): string[] {
  return subjects.map((s) => generateIssueFingerprint(makeIssue(s)))
}

function makeSession(
  overrides: Partial<RoutingContext['session']> = {}
): RoutingContext['session'] {
  return {
    chapterIndex: 0,
    rewriteAttempts: 0,
    errorRewriteAttempts: 0,
    autoFixAttempts: 0,
    previousIssues: [],
    previousRawErrorCount: 0,
    routingDecision: undefined,
    forceStructuralRewrite: false,
    rewriteApproved: true,
    issueFingerprintHistory: [],
    ...overrides,
  }
}

function makeDeps(config: ChapterPlanningConfig = planningConfig): RoutingDeps {
  return {
    issuePolicy: {
      planningConfig: config,
      isInterpretiveIssue: () => false,
    },
    rewritePolicy: {
      planningConfig: config,
      calculateIssueSetSimilarity: () => Promise.resolve(0),
      isInterpretiveIssue: () => false,
      isStateCorruptionIssue: () => false,
    },
    fixPolicy: {},
  }
}

describe('isFingerprintSubset', () => {
  it('returns true when every current fingerprint appeared in the previous round', () => {
    expect(isFingerprintSubset(['a', 'b', 'c'], ['a', 'c'])).toBe(true)
  })

  it('returns true for identical sets', () => {
    expect(isFingerprintSubset(['a', 'b'], ['a', 'b'])).toBe(true)
  })

  it('returns false when the current round introduces a new fingerprint', () => {
    expect(isFingerprintSubset(['a', 'b'], ['a', 'c'])).toBe(false)
  })

  it('returns false when either side is empty', () => {
    expect(isFingerprintSubset([], ['a'])).toBe(false)
    expect(isFingerprintSubset(['a'], [])).toBe(false)
    expect(isFingerprintSubset([], [])).toBe(false)
  })

  it('ignores duplicates in the current round', () => {
    expect(isFingerprintSubset(['a', 'b'], ['a', 'a'])).toBe(true)
  })
})

describe('calculateFingerprintSetSimilarity', () => {
  it('returns 0 for empty inputs and 1 for identical sets', () => {
    expect(calculateFingerprintSetSimilarity([], ['a'])).toBe(0)
    expect(calculateFingerprintSetSimilarity(['a', 'b'], ['a', 'b'])).toBe(1)
  })
})

describe('rewrite loop subset stall detection', () => {
  it('does not schedule an automatic fix after the configured attempt limit', async () => {
    const config = {
      ...planningConfig,
      maxAutoFixAttempts: 1,
    }
    const ctx: RoutingContext = {
      session: makeSession({ rewriteApproved: false, autoFixAttempts: 1 }),
      pendingIssues: [
        {
          id: 'quality-warning',
          ruleId: 'quality.local-style',
          type: 'consistency',
          severity: 'warning',
          description: '局部表达需要调整',
          dimension: 'quality',
          locationRef: { paragraphIndex: 0 },
        },
      ],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: undefined,
    }

    const result = await decideNextStep(ctx, makeDeps(config))

    expect(result.step.kind).toBe('finalize_chapter')
  })

  it('does not stall after three similar rounds when four are configured', async () => {
    const config = {
      ...planningConfig,
      rewriteStallMinRounds: 4,
    }
    const repeated = fingerprints(['a', 'b'])
    const ctx: RoutingContext = {
      session: makeSession({
        issueFingerprintHistory: [repeated, repeated],
      }),
      pendingIssues: [makeIssue('a'), makeIssue('b')],
      genre: 'general',
      chapterFileExists: false,
      structuredValidationResult: undefined,
    }

    const result = await decideNextStep(ctx, makeDeps(config))

    expect(result.step.kind).toBe('draft_chapter')
  })

  it('does not stall when four rounds stay below the configured similarity threshold', async () => {
    const config = {
      ...planningConfig,
      rewriteStallSimilarityThreshold: 0.9,
      rewriteStallMinRounds: 4,
    }
    const ctx: RoutingContext = {
      session: makeSession({
        issueFingerprintHistory: [
          fingerprints(['a', 'b', 'c', 'd', 'e']),
          fingerprints(['a', 'b', 'c', 'd', 'f']),
          fingerprints(['a', 'b', 'c', 'd', 'g']),
        ],
      }),
      pendingIssues: [
        makeIssue('a'),
        makeIssue('b'),
        makeIssue('c'),
        makeIssue('d'),
        makeIssue('h'),
      ],
      genre: 'general',
      chapterFileExists: false,
      structuredValidationResult: undefined,
    }

    const result = await decideNextStep(ctx, makeDeps(config))

    expect(result.step.kind).toBe('draft_chapter')
  })

  it('stops a rewrite loop whose error set keeps shrinking as subsets', async () => {
    // 相似度视角下 2/5 = 0.4 < 0.7，旧检测不会触发；但两轮均为严格子集，应判定停滞。
    const ctx: RoutingContext = {
      session: makeSession({
        issueFingerprintHistory: [
          fingerprints(['a', 'b', 'c', 'd', 'e']),
          fingerprints(['a', 'b']),
        ],
      }),
      pendingIssues: [makeIssue('a')],
      genre: 'general',
      chapterFileExists: false,
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).toBe('request_rewrite')
    expect(result.step).toMatchObject({ reason: 'rewrite_loop_stalled' })
    expect(result.sessionUpdate.rewriteApproved).toBe(false)
    expect(result.sessionUpdate.issueFingerprintHistory).toHaveLength(3)
  })

  it('keeps rewriting when the error set changes between rounds', async () => {
    const ctx: RoutingContext = {
      session: makeSession({
        issueFingerprintHistory: [fingerprints(['a', 'b', 'c']), fingerprints(['d', 'e', 'f'])],
      }),
      pendingIssues: [makeIssue('g'), makeIssue('h')],
      genre: 'general',
      chapterFileExists: false,
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).toBe('draft_chapter')
  })

  it('does not stall before three rounds of history', async () => {
    const ctx: RoutingContext = {
      session: makeSession({
        issueFingerprintHistory: [fingerprints(['a', 'b', 'c'])],
      }),
      pendingIssues: [makeIssue('a')],
      genre: 'general',
      chapterFileExists: false,
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).toBe('draft_chapter')
  })
})
