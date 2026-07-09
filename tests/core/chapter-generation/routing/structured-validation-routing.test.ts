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
    fixPolicy: {
      planningConfig,
      splitIntoParagraphs: () => [],
      findAffectedParagraphs: () => [],
    },
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
    unfulfilledRequiredForeshadows: [],
    overdueForeshadows: [],
    falseFulfillments: [],
    unclaimedMandatoryBeats: [],
    claimedButUnprovenBeats: [],
    stateConflicts: [],
    ...overrides,
  }
}

describe('decideNextStep structured validation routing', () => {
  it('routes to fix_chapter and injects structured issues when state conflicts exist', async () => {
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

    expect(result.step.kind).toBe('fix')
    expect(result.processedIssues).toHaveLength(1)
    expect(result.processedIssues[0]?.type).toBe('state_conflict')
    expect(result.processedIssues[0]?.severity).toBe('error')
  })

  it('routes to fix_chapter and injects structured issues when claimed beats are unproven', async () => {
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

    expect(result.step.kind).toBe('fix')
    expect(result.processedIssues).toHaveLength(1)
    expect(result.processedIssues[0]?.type).toBe('beat_unproven')
    expect(result.processedIssues[0]?.description).toContain('beat-1')
  })

  it('routes to fix_chapter and injects structured issues when foreshadow fulfillment is false', async () => {
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

    expect(result.step.kind).toBe('fix')
    expect(result.processedIssues).toHaveLength(1)
    expect(result.processedIssues[0]?.type).toBe('foreshadow_false_fulfillment')
    expect(result.processedIssues[0]?.description).toContain('fs-1')
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
