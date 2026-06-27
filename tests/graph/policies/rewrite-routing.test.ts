import { describe, expect, it, vi } from 'vitest'
import {
  DefaultRewriteRoutingPolicy,
  DEFAULT_REWRITE_ROUTING_CONFIG,
  capNonErrorIssuesByType,
  calculateIssueSetSimilarity,
  downgradeInterpretiveErrors,
  buildVerifiedConstraints,
  type RewritePolicyServices,
  type RewriteRoutingConfig,
  type Issue,
} from '../../../src/graph/policies/rewrite-routing.js'

function createServices(overrides: Partial<RewritePolicyServices> = {}): RewritePolicyServices {
  return {
    isStructuralIssue: () => false,
    isLocalIssue: () => false,
    isTaskConsistencyIssue: () => false,
    isStateCorruptionIssue: () => false,
    deduplicateIssues: issues => issues,
    issueFingerprint: issue => `${issue.type}:${issue.description}`,
    isInterpretiveIssue: () => false,
    shouldForceTemporaryReplan: () => false,
    readChapterContent: vi.fn().mockResolvedValue(null),
    log: vi.fn(),
    ...overrides,
  }
}

function createIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: '1',
    type: 'quality',
    severity: 'error',
    description: 'default issue',
    ...overrides,
  }
}

const baseConfig: Required<RewriteRoutingConfig> = {
  ...DEFAULT_REWRITE_ROUTING_CONFIG,
  maxNonErrorIssuesPerType: 5,
  maxVerifiedConstraints: 10,
}

describe('DefaultRewriteRoutingPolicy.decideStrategy', () => {
  it('finalizes when no errors and chapter file exists on first draft', async () => {
    const policy = new DefaultRewriteRoutingPolicy()
    const services = createServices({
      readChapterContent: vi.fn().mockResolvedValue('existing content'),
    })

    const result = await policy.decideStrategy({
      chapterIndex: 0,
      rewriteApproved: false,
      rewriteAttempts: 0,
      errorRewriteAttempts: 0,
      forceStructuralRewrite: false,
      pendingIssues: [],
      chapterPlanExists: false,
      config: baseConfig,
      services,
    })

    expect(result.decision).toBe('finalize_chapter')
    expect(result.rewriteApproved).toBe(false)
  })

  it('drafts when no errors and chapter file does not exist', async () => {
    const policy = new DefaultRewriteRoutingPolicy()
    const services = createServices({
      readChapterContent: vi.fn().mockResolvedValue(null),
    })

    const result = await policy.decideStrategy({
      chapterIndex: 0,
      rewriteApproved: false,
      rewriteAttempts: 0,
      errorRewriteAttempts: 0,
      forceStructuralRewrite: false,
      pendingIssues: [],
      chapterPlanExists: false,
      config: baseConfig,
      services,
    })

    expect(result.decision).toBe('draft_chapter')
    expect(result.feedbackIssues).toEqual([])
  })

  it('requests rewrite when all errors are state corruption', async () => {
    const policy = new DefaultRewriteRoutingPolicy()
    const services = createServices({
      isStateCorruptionIssue: issue => issue.description.includes('位置冲突'),
    })
    const pendingIssues = [
      createIssue({ description: '物品位置冲突' }),
      createIssue({ description: '关键物品位置冲突' }),
    ]

    const result = await policy.decideStrategy({
      chapterIndex: 1,
      rewriteApproved: true,
      rewriteAttempts: 1,
      errorRewriteAttempts: 1,
      forceStructuralRewrite: false,
      pendingIssues,
      chapterPlanExists: true,
      config: baseConfig,
      services,
    })

    expect(result.decision).toBe('request_rewrite')
    expect(result.rewriteApproved).toBe(false)
  })

  it('discards plan and drafts for structural-only errors', async () => {
    const policy = new DefaultRewriteRoutingPolicy()
    const services = createServices({
      isStructuralIssue: issue => issue.type === 'outline_violation',
      readChapterContent: vi.fn().mockResolvedValue('content'),
    })
    const pendingIssues = [createIssue({ type: 'outline_violation' })]

    const result = await policy.decideStrategy({
      chapterIndex: 1,
      rewriteApproved: true,
      rewriteAttempts: 1,
      errorRewriteAttempts: 1,
      forceStructuralRewrite: false,
      pendingIssues,
      chapterPlanExists: true,
      config: baseConfig,
      services,
    })

    expect(result.decision).toBe('draft_chapter')
    expect(result.discardPlan).toBe(true)
  })

  it('chooses fix mode for local-only errors when chapter file exists', async () => {
    const policy = new DefaultRewriteRoutingPolicy()
    const services = createServices({
      isLocalIssue: issue => issue.severity === 'error',
      readChapterContent: vi.fn().mockResolvedValue('content'),
    })
    const pendingIssues = [createIssue({ type: 'quality' })]

    const result = await policy.decideStrategy({
      chapterIndex: 1,
      rewriteApproved: true,
      rewriteAttempts: 1,
      errorRewriteAttempts: 1,
      forceStructuralRewrite: false,
      pendingIssues,
      chapterPlanExists: true,
      config: baseConfig,
      services,
    })

    expect(result.decision).toBe('fix_chapter')
    expect(result.discardPlan).toBe(false)
  })

  it('drafts when chapter file is missing even for local errors', async () => {
    const policy = new DefaultRewriteRoutingPolicy()
    const services = createServices({
      isLocalIssue: issue => issue.severity === 'error',
      readChapterContent: vi.fn().mockResolvedValue(null),
    })
    const pendingIssues = [createIssue({ type: 'quality' })]

    const result = await policy.decideStrategy({
      chapterIndex: 1,
      rewriteApproved: true,
      rewriteAttempts: 1,
      errorRewriteAttempts: 1,
      forceStructuralRewrite: false,
      pendingIssues,
      chapterPlanExists: true,
      config: baseConfig,
      services,
    })

    expect(result.decision).toBe('draft_chapter')
  })

  it('discards plan for task consistency errors', async () => {
    const policy = new DefaultRewriteRoutingPolicy()
    const services = createServices({
      isTaskConsistencyIssue: () => true,
      readChapterContent: vi.fn().mockResolvedValue('content'),
    })
    const pendingIssues = [createIssue({ type: 'consistency' })]

    const result = await policy.decideStrategy({
      chapterIndex: 1,
      rewriteApproved: true,
      rewriteAttempts: 1,
      errorRewriteAttempts: 1,
      forceStructuralRewrite: false,
      pendingIssues,
      chapterPlanExists: true,
      config: baseConfig,
      services,
    })

    expect(result.decision).toBe('draft_chapter')
    expect(result.discardPlan).toBe(true)
  })
})

describe('DefaultRewriteRoutingPolicy.convergenceCheck', () => {
  it('finalizes when no errors remain', () => {
    const policy = new DefaultRewriteRoutingPolicy()
    const services = createServices()

    const result = policy.convergenceCheck({
      rewriteApproved: true,
      errorRewriteAttempts: 2,
      previousIssues: [],
      previousRawErrorCount: 0,
      pendingIssues: [],
      verifiedConstraints: [],
      config: baseConfig,
      services,
    })

    expect(result.decision).toBe('finalize_chapter')
    expect(result.rewriteApproved).toBe(false)
  })

  it('returns to decide_strategy when below max attempts', () => {
    const policy = new DefaultRewriteRoutingPolicy()
    const services = createServices()
    const pendingIssues = [createIssue()]

    const result = policy.convergenceCheck({
      rewriteApproved: true,
      errorRewriteAttempts: 1,
      previousIssues: [],
      previousRawErrorCount: 0,
      pendingIssues,
      verifiedConstraints: [],
      config: baseConfig,
      services,
    })

    expect(result.decision).toBe('decide_strategy')
    expect(result.rewriteApproved).toBe(true)
  })

  it('requests rewrite after max attempts', () => {
    const policy = new DefaultRewriteRoutingPolicy()
    const services = createServices()
    const pendingIssues = [createIssue()]

    const result = policy.convergenceCheck({
      rewriteApproved: true,
      errorRewriteAttempts: 3,
      previousIssues: [],
      previousRawErrorCount: 0,
      pendingIssues,
      verifiedConstraints: [],
      config: baseConfig,
      services,
    })

    expect(result.decision).toBe('request_rewrite')
    expect(result.rewriteApproved).toBe(false)
  })

  it('forces structural rewrite when error count increases', () => {
    const policy = new DefaultRewriteRoutingPolicy()
    const services = createServices()
    const pendingIssues = [createIssue(), createIssue()]

    const result = policy.convergenceCheck({
      rewriteApproved: true,
      errorRewriteAttempts: 2,
      previousIssues: [createIssue()],
      previousRawErrorCount: 1,
      pendingIssues,
      verifiedConstraints: [],
      config: baseConfig,
      services,
    })

    expect(result.forceStructuralRewrite).toBe(true)
    expect(result.decision).toBe('decide_strategy')
  })

  it('forces structural rewrite when issue set is highly similar', () => {
    const policy = new DefaultRewriteRoutingPolicy()
    const services = createServices()
    const issue = createIssue({ description: 'same issue' })

    const result = policy.convergenceCheck({
      rewriteApproved: true,
      errorRewriteAttempts: 2,
      previousIssues: [issue],
      previousRawErrorCount: 1,
      pendingIssues: [issue],
      verifiedConstraints: [],
      config: baseConfig,
      services,
    })

    expect(result.forceStructuralRewrite).toBe(true)
  })

  it('downgrades interpretive errors on final allowed pass', () => {
    const policy = new DefaultRewriteRoutingPolicy()
    const services = createServices({
      isInterpretiveIssue: issue => issue.description.includes('表达方式'),
      issueFingerprint: issue => `${issue.type}:${issue.description}`,
    })
    const pendingIssues = [
      createIssue({ description: '表达方式需要调整' }),
    ]

    const result = policy.convergenceCheck({
      rewriteApproved: true,
      errorRewriteAttempts: 2,
      previousIssues: [{ ...pendingIssues[0]!, id: 'prev', description: 'different previous' }],
      previousRawErrorCount: 1,
      pendingIssues,
      verifiedConstraints: [],
      config: { ...baseConfig, maxErrorRewriteAttempts: 3 },
      services,
    })

    expect(result.pendingIssues[0]!.severity).toBe('warning')
    expect(result.decision).toBe('finalize_chapter')
  })

  it('caps non-error issues per type', () => {
    const policy = new DefaultRewriteRoutingPolicy()
    const services = createServices()
    const pendingIssues = Array.from({ length: 6 }, (_, i) =>
      createIssue({
        id: `${i}`,
        severity: 'warning',
        type: 'quality',
        description: `warning ${i}`,
      })
    )

    const result = policy.convergenceCheck({
      rewriteApproved: true,
      errorRewriteAttempts: 1,
      previousIssues: [],
      previousRawErrorCount: 0,
      pendingIssues,
      verifiedConstraints: [],
      config: { ...baseConfig, maxNonErrorIssuesPerType: 3 },
      services,
    })

    expect(result.pendingIssues).toHaveLength(3)
  })

  it('records verified constraints for resolved errors', () => {
    const policy = new DefaultRewriteRoutingPolicy()
    const services = createServices()
    const previousIssues = [createIssue({ id: 'prev', description: 'fixed issue' })]
    const pendingIssues = [createIssue({ id: 'curr', description: 'remaining issue' })]

    const result = policy.convergenceCheck({
      rewriteApproved: true,
      errorRewriteAttempts: 1,
      previousIssues,
      previousRawErrorCount: 1,
      pendingIssues,
      verifiedConstraints: [],
      config: baseConfig,
      services,
    })

    expect(result.verifiedConstraints).toHaveLength(1)
    expect(result.verifiedConstraints[0]).toContain('fixed issue')
  })
})

describe('capNonErrorIssuesByType', () => {
  it('keeps all issues when under cap', () => {
    const issues = [
      createIssue({ severity: 'warning', type: 'quality' }),
      createIssue({ severity: 'warning', type: 'quality' }),
    ]
    const log = vi.fn()
    const result = capNonErrorIssuesByType(issues, 3, log)
    expect(result).toHaveLength(2)
  })

  it('caps non-error issues and keeps all errors', () => {
    const issues = [
      createIssue({ severity: 'error', type: 'quality' }),
      ...Array.from({ length: 4 }, (_, i) =>
        createIssue({ id: `${i}`, severity: 'warning', type: 'quality' })
      ),
    ]
    const log = vi.fn()
    const result = capNonErrorIssuesByType(issues, 2, log)
    expect(result).toHaveLength(3)
    expect(log).toHaveBeenCalled()
  })
})

describe('calculateIssueSetSimilarity', () => {
  it('returns 0 when one set is empty', () => {
    const issue = createIssue()
    expect(calculateIssueSetSimilarity([], [issue], i => i.description)).toBe(0)
  })

  it('returns 1 for identical sets', () => {
    const issue = createIssue()
    expect(calculateIssueSetSimilarity([issue], [issue], i => i.description)).toBe(1)
  })

  it('returns 0.5 for half overlap', () => {
    const a = createIssue({ description: 'a' })
    const b = createIssue({ description: 'b' })
    expect(calculateIssueSetSimilarity([a, b], [a], i => i.description)).toBe(0.5)
  })
})

describe('downgradeInterpretiveErrors', () => {
  it('downgrades interpretive errors to warnings', () => {
    const issues = [createIssue({ description: '表达方式生硬' })]
    const result = downgradeInterpretiveErrors(
      issues,
      issue => issue.description.includes('表达方式')
    )
    expect(result.issues[0]!.severity).toBe('warning')
    expect(result.downgraded).toBe(true)
  })

  it('leaves non-interpretive errors unchanged', () => {
    const issues = [createIssue({ description: 'logic error' })]
    const result = downgradeInterpretiveErrors(
      issues,
      issue => issue.description.includes('表达方式')
    )
    expect(result.issues[0]!.severity).toBe('error')
    expect(result.downgraded).toBe(false)
  })
})

describe('buildVerifiedConstraints', () => {
  it('records constraints for resolved errors', () => {
    const previous = [createIssue({ description: 'resolved' })]
    const current = [createIssue({ description: 'remaining' })]
    const log = vi.fn()

    const result = buildVerifiedConstraints(
      previous,
      current,
      () => false,
      10,
      log
    )

    expect(result.resolvedCount).toBe(1)
    expect(result.constraints[0]).toContain('resolved')
  })

  it('ignores interpretive resolved issues', () => {
    const previous = [createIssue({ description: 'interpretive' })]
    const current: Issue[] = []
    const log = vi.fn()

    const result = buildVerifiedConstraints(
      previous,
      current,
      issue => issue.description === 'interpretive',
      10,
      log
    )

    expect(result.resolvedCount).toBe(0)
  })

  it('trims constraints to max', () => {
    const previous = [createIssue({ description: 'old' })]
    const current: Issue[] = []
    const log = vi.fn()

    const result = buildVerifiedConstraints(
      previous,
      current,
      () => false,
      0,
      log
    )

    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('verifiedConstraints 超过 0 条')
    )
    expect(result.constraints).toHaveLength(0)
  })
})
