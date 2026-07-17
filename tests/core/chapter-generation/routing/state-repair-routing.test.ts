import { describe, expect, it } from 'vitest'
import { decideNextStep } from '../../../../src/core/chapter-generation/routing/index.js'
import type {
  RoutingContext,
  RoutingDeps,
} from '../../../../src/core/chapter-generation/routing/types.js'
import type { Issue } from '../../../../src/types/agent.js'
import type { ChapterPlanningConfig } from '../../../../src/types/genre.js'
import { DEFAULT_CHAPTER_PLANNING_CONFIG } from '../../../../src/utils/chapter-planning.js'

const planningConfig: ChapterPlanningConfig = {
  ...DEFAULT_CHAPTER_PLANNING_CONFIG,
  downgradeInterpretiveErrors: false,
}

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

function makeDeps(
  config: ChapterPlanningConfig = planningConfig,
  overrides: Partial<RoutingDeps> = {}
): RoutingDeps {
  return {
    issuePolicy: {
      planningConfig: config,
      isInterpretiveIssue: () => false,
    },
    rewritePolicy: {
      planningConfig: config,
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
    expect(result.sessionUpdate.stateRepairAttempts).toBe(1)
    expect(result.sessionUpdate.rewriteApproved).toBeUndefined()
  })

  it('allows a second repair attempt with rejection feedback available', async () => {
    const ctx: RoutingContext = {
      session: makeSession({
        stateRepairAttempts: 1,
        stateRepairRejections: ['c-1/location: l-1 → l-2（oldValue 与当前记录值不精确相等）'],
      }),
      pendingIssues: [stateCorruptionError('e1')],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: undefined,
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step).toEqual({ kind: 'repair_state' })
    expect(result.sessionUpdate.stateRepairAttempts).toBe(2)
  })

  it('falls back to request_rewrite once state repair attempts are exhausted', async () => {
    const ctx: RoutingContext = {
      session: makeSession({ stateRepairAttempts: 2 }),
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

  it('uses the configured state repair attempt limit', async () => {
    const ctx: RoutingContext = {
      session: makeSession({ stateRepairAttempts: 1 }),
      pendingIssues: [stateCorruptionError('e1')],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: undefined,
    }
    const config = {
      ...planningConfig,
      maxStateRepairAttempts: 1,
    }

    const result = await decideNextStep(ctx, makeDeps(config))

    expect(result.step).toMatchObject({
      kind: 'request_rewrite',
      reason: 'state_corruption',
    })
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
    expect(result.sessionUpdate.stateRepairAttempts).toBe(1)
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
