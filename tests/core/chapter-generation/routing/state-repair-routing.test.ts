import { describe, expect, it } from 'vitest'
import { decideNextStep } from '../../../../src/core/chapter-generation/routing/index.js'
import type {
  RoutingContext,
  RoutingDeps,
} from '../../../../src/core/chapter-generation/routing/types.js'
import type { Issue } from '../../../../src/types/agent.js'
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
    chapterIndex: 24,
    rewriteAttempts: 2,
    errorRewriteAttempts: 1,
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
      isStateCorruptionIssue: (issue) => issue.dimension === 'structured_state',
    },
    fixPolicy: {},
    ...overrides,
  }
}

function stateCorruptionError(id: string): Issue {
  return {
    id,
    type: 'consistency',
    severity: 'error',
    dimension: 'structured_state',
    description: '状态记录与已定稿章节正文矛盾',
    retryStrategy: 'draft',
  }
}

describe('decideNextStep state repair routing (Case 1)', () => {
  it('routes to repair_state on the first all-state-corruption round', async () => {
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [stateCorruptionError('e1'), stateCorruptionError('e2')],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: undefined,
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step).toEqual({ kind: 'repair_state' })
    expect(result.sessionUpdate.stateRepairAttempted).toBe(true)
    expect(result.sessionUpdate.rewriteApproved).toBeUndefined()
  })

  it('falls back to request_rewrite once state repair was already attempted', async () => {
    const ctx: RoutingContext = {
      session: makeSession({ stateRepairAttempted: true }),
      pendingIssues: [stateCorruptionError('e1')],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: undefined,
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step).toMatchObject({
      kind: 'request_rewrite',
      reason: 'state_corruption',
    })
    expect(result.sessionUpdate.rewriteApproved).toBe(false)
  })

  it('routes to repair_state when at least one error is state-corruption, even if other errors exist', async () => {
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [
        stateCorruptionError('e1'),
        {
          id: 'e2',
          type: 'consistency',
          severity: 'error',
          dimension: 'causality',
          description: '因果关系不连贯',
          retryStrategy: 'draft',
        },
      ],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: undefined,
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step).toEqual({ kind: 'repair_state' })
    expect(result.sessionUpdate.stateRepairAttempted).toBe(true)
  })

  it('does not route to repair_state when no error is state-corruption', async () => {
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [
        {
          id: 'e1',
          type: 'consistency',
          severity: 'error',
          dimension: 'causality',
          description: '因果关系不连贯',
          retryStrategy: 'draft',
        },
      ],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: undefined,
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).not.toBe('repair_state')
    expect(result.step.kind).not.toBe('request_rewrite')
  })

  it('does not route to repair_state outside an approved rewrite loop', async () => {
    const ctx: RoutingContext = {
      session: makeSession({ rewriteApproved: false }),
      pendingIssues: [stateCorruptionError('e1')],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: undefined,
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).not.toBe('repair_state')
  })
})
