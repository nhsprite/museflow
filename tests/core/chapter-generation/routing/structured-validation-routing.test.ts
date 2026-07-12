import { describe, expect, it } from 'vitest'
import { decideNextStep } from '../../../../src/core/chapter-generation/routing/index.js'
import type {
  RoutingContext,
  RoutingDeps,
} from '../../../../src/core/chapter-generation/routing/types.js'
import type { Issue } from '../../../../src/types/agent.js'
import type { StructuredValidationResult } from '../../../../src/story-memory/validator.js'
import type { ChapterPlanningConfig } from '../../../../src/types/genre.js'

const planningConfig: ChapterPlanningConfig = {
  maxNonErrorIssuesPerType: 3,
  maxErrorRewriteAttempts: 3,
  issueSetSimilarityThreshold: 0.5,
  downgradeInterpretiveErrors: false,
} as ChapterPlanningConfig

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
    rewriteApproved: false,
    issueFingerprintHistory: [],
    ...overrides,
  }
}

function makeDeps(overrides: Partial<RoutingDeps> = {}): RoutingDeps {
  return {
    issuePolicy: {
      planningConfig,
      isInterpretiveIssue: () => false,
    },
    rewritePolicy: {
      planningConfig,
      calculateIssueSetSimilarity: () => Promise.resolve(0),
      isInterpretiveIssue: () => false,
      isStateCorruptionIssue: () => false,
    },
    fixPolicy: {},
    isStructuralIssue: () => false,
    isLocalIssue: () => false,
    isTaskConsistencyIssue: () => false,
    ...overrides,
  }
}

function makeStructuredResult(
  overrides: Partial<StructuredValidationResult> = {}
): StructuredValidationResult {
  return {
    expectedEvents: [],
    actualEvents: [],
    missingEvents: [],
    unexpectedEvents: [],
    eventsMissingEvidence: [],
    eventsWithInvalidEvidence: [],
    eventsWithInvalidForeshadowDeadline: [],
    unfulfilledRequiredForeshadows: [],
    overdueForeshadows: [],
    falseFulfillments: [],
    unclaimedMandatoryBeats: [],
    claimedButUnprovenBeats: [],
    stateConflicts: [],
    finalStateMismatches: [],
    finalStateUncorroborated: [],
    ...overrides,
  }
}

describe('decideNextStep structured validation routing', () => {
  it('routes structured state conflicts through a counted draft retry', async () => {
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: false,
      structuredValidationResult: makeStructuredResult({
        stateConflicts: [
          {
            entityId: 'c-1',
            attribute: 'location',
            eventA: {
              id: 'e1',
              type: 'character-location',
              characterId: 'c-1',
              locationId: 'l-1',
              chapterIndex: 0,
              source: 'chapter',
            },
            eventB: {
              id: 'e2',
              type: 'character-location',
              characterId: 'c-1',
              locationId: 'l-2',
              chapterIndex: 0,
              source: 'chapter',
            },
            description: '角色在同一章出现在两个地点',
          },
        ],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step).toMatchObject({ kind: 'draft', discardPlan: false })
    expect(result.sessionUpdate.errorRewriteAttempts).toBe(1)
    expect(result.processedIssues).toHaveLength(1)
    expect(result.processedIssues[0]?.type).toBe('state_conflict')
    expect(result.processedIssues[0]?.severity).toBe('error')
    expect(result.processedIssues[0]?.retryStrategy).toBe('draft')
  })

  it('routes to draft and injects structured issues when claimed beats are unproven', async () => {
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: false,
      structuredValidationResult: makeStructuredResult({
        claimedButUnprovenBeats: ['beat-1'],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).toBe('draft')
    expect(result.processedIssues).toHaveLength(1)
    expect(result.processedIssues[0]?.type).toBe('beat_unproven')
    expect(result.processedIssues[0]?.description).toContain('beat-1')
  })

  it('routes to draft and injects structured issues when foreshadow fulfillment is false', async () => {
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: false,
      structuredValidationResult: makeStructuredResult({
        falseFulfillments: ['fs-1'],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).toBe('draft')
    expect(result.processedIssues).toHaveLength(1)
    expect(result.processedIssues[0]?.type).toBe('foreshadow_false_fulfillment')
    expect(result.processedIssues[0]?.description).toContain('fs-1')
  })

  it('routes to draft when a foreshadow introduction has an invalid deadline', async () => {
    const invalidEvent = {
      id: 'evt-invalid-deadline',
      type: 'foreshadow-introduce' as const,
      foreshadowId: 'fs-invalid',
      expectedFulfillChapter: 0,
      chapterIndex: 9,
      source: 'chapter' as const,
    }
    const ctx: RoutingContext = {
      session: makeSession({ chapterIndex: 9 }),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult({
        eventsWithInvalidForeshadowDeadline: [invalidEvent],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).toBe('draft')
    expect(result.processedIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'foreshadow_invalid_deadline',
          severity: 'error',
          retryStrategy: 'draft',
        }),
      ])
    )
  })

  it('keeps overdue required foreshadows non-blocking during an ordinary chapter', async () => {
    const ctx: RoutingContext = {
      session: makeSession({ chapterIndex: 9 }),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult({
        unfulfilledRequiredForeshadows: ['fs-due'],
        overdueForeshadows: ['fs-overdue'],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).not.toBe('fix')
    expect(result.processedIssues).toEqual([])
  })

  it('treats the invalid-deadline field as empty when resuming a legacy checkpoint', async () => {
    const currentResult = makeStructuredResult()
    const { eventsWithInvalidForeshadowDeadline: _newField, ...legacyResult } = currentResult
    const ctx: RoutingContext = {
      session: makeSession({ chapterIndex: 10 }),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: false,
      structuredValidationResult: legacyResult as StructuredValidationResult,
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).toBe('draft')
    expect(result.processedIssues).toEqual([])
  })

  it('routes to draft when expected events are missing', async () => {
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: false,
      structuredValidationResult: makeStructuredResult({
        missingEvents: [
          {
            id: 'evt-expected',
            type: 'character-location',
            characterId: 'c-1',
            locationId: 'l-1',
            chapterIndex: 0,
            source: 'chapter',
          },
        ],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).toBe('draft')
    expect(result.processedIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'event_missing',
          severity: 'error',
        }),
      ])
    )
  })

  it('routes to draft when story events lack evidence', async () => {
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: false,
      structuredValidationResult: makeStructuredResult({
        eventsMissingEvidence: [
          {
            id: 'evt-no-evidence',
            type: 'plot-advance',
            plotId: 'plot-1',
            beatId: 'beat-1',
            chapterIndex: 0,
            source: 'chapter',
          },
        ],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).toBe('draft')
    expect(result.processedIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'event_evidence_missing',
          severity: 'error',
        }),
      ])
    )
  })

  it('merges structured issues with existing pending issues', async () => {
    const pendingIssue: Issue = {
      id: 'pending-1',
      type: 'consistency',
      severity: 'error',
      description: '既有问题',
    }
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [pendingIssue],
      genre: 'general',
      chapterFileExists: false,
      structuredValidationResult: makeStructuredResult({
        falseFulfillments: ['fs-1'],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.processedIssues).toHaveLength(2)
    expect(result.processedIssues.map((i) => i.description)).toContain('既有问题')
    expect(result.processedIssues.some((i) => i.type === 'foreshadow_false_fulfillment')).toBe(true)
  })

  it('does not route to fix when structured validation has no blocking problems', async () => {
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: false,
      structuredValidationResult: makeStructuredResult(),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).not.toBe('request_rewrite')
  })

  it('requests manual rewrite after structured failures exhaust the retry budget', async () => {
    const ctx: RoutingContext = {
      session: makeSession({ errorRewriteAttempts: 3 }),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult({
        missingEvents: [
          {
            id: 'evt-expected',
            type: 'item-location',
            itemId: 'item-1',
            holderId: null,
            locationId: 'loc-1',
            chapterIndex: 0,
            source: 'chapter',
          },
        ],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step).toMatchObject({
      kind: 'request_rewrite',
      reason: 'max_rewrite_attempts',
    })
  })

  it('replaces structured issues from the previous validation round', async () => {
    const oldMissingEventIssue: Issue = {
      id: 'old-missing',
      type: 'event_missing',
      severity: 'error',
      description: 'old structured issue',
      retryStrategy: 'draft',
    }
    const unrelatedWarning: Issue = {
      id: 'warning-1',
      type: 'consistency',
      severity: 'warning',
      description: 'keep this warning',
      dimension: 'quality',
    }
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [oldMissingEventIssue, unrelatedWarning],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult({
        unexpectedEvents: [
          {
            id: 'evt-actual',
            type: 'task-resolve',
            taskId: 'task-1',
            chapterIndex: 0,
            source: 'chapter',
          },
        ],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.processedIssues.some((issue) => issue.id === oldMissingEventIssue.id)).toBe(false)
    expect(result.processedIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'event_unexpected' }),
        unrelatedWarning,
      ])
    )
  })

  it('clears stale structured issues after structured validation passes', async () => {
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [
        {
          id: 'old-missing',
          type: 'event_missing',
          severity: 'error',
          description: 'old structured issue',
          retryStrategy: 'draft',
        },
      ],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult(),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.processedIssues).toEqual([])
    expect(result.step.kind).toBe('finalize')
  })

  it('routes fix retry issues to draft when the chapter file is missing', async () => {
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [
        {
          id: 'word-count-1',
          type: 'word_count',
          severity: 'error',
          description: '第 1 章字数 8114 超过上限 8000 字',
          source: 'word_count',
          retryStrategy: 'fix',
        },
      ],
      genre: 'general',
      chapterFileExists: false,
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step).toEqual({
      kind: 'draft',
      discardPlan: false,
      feedbackIssues: ctx.pendingIssues,
    })
  })
})
