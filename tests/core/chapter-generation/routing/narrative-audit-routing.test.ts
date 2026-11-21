import { describe, expect, it } from 'vitest'
import { decideNextStep } from '../../../../src/core/chapter-generation/routing/index.js'
import type {
  RoutingContext,
  RoutingDeps,
} from '../../../../src/core/chapter-generation/routing/types.js'
import { createChapterSession } from '../../../../src/core/chapter-generation/routing/session.js'
import { DEFAULT_CHAPTER_PLANNING_CONFIG } from '../../../../src/utils/chapter-planning.js'
import { narrativeAuditIssues } from '../../../../src/graph/services/narrative-audit/index.js'
import { buildZeroProgressRejectionSection } from '../../../../src/agents/prompts/fragments/zero-progress-rejection.js'
import type { NarrativeAuditReport } from '../../../../src/types/narrative-audit.js'

function setup() {
  const planningConfig = { ...DEFAULT_CHAPTER_PLANNING_CONFIG }
  const deps: RoutingDeps = {
    issuePolicy: { planningConfig, isInterpretiveIssue: () => false },
    rewritePolicy: {
      planningConfig,
      calculateIssueSetSimilarity: async () => 0,
      isInterpretiveIssue: () => false,
      isStateCorruptionIssue: () => false,
    },
    fixPolicy: {},
  }
  const report: NarrativeAuditReport = {
    protocolVersion: 3,
    mode: 'enforce',
    chapterIndex: 2,
    contentHash: 'current',
    recordsHash: 'records',
    records: [],
    window: [0, 1, 2].map((chapterIndex) => ({ chapterIndex, contentHash: 'hash' })),
    facts: [],
    coverage: [],
    findings: [],
    progress: [0, 1, 2].map((chapterIndex) => ({
      chapterIndex,
      verdict: 'stalled',
      dimensions: [],
      evidenceParagraphs: [0],
      explanation: '持续盘点既有物品，未产生新的处境。',
    })),
  }
  const ctx: RoutingContext = {
    session: createChapterSession(2, { validatedContentHash: 'current', narrativeAudit: report }),
    pendingIssues: narrativeAuditIssues(report),
    genre: 'default',
    chapterFileExists: true,
    structuredValidationResult: undefined,
    outline: [{}, {}, { title: '静止', description: '原大纲' }] as any,
  }
  return { ctx, deps, report, planningConfig }
}

describe('narrative audit routing', () => {
  it('replans a stalled window despite nonzero structural increments', async () => {
    const { ctx, deps } = setup()
    // No zero-increment signal exists: narrative assessment alone must reach planning.
    const result = await decideNextStep(ctx, deps)
    expect(result.step).toMatchObject({
      kind: 'draft_chapter',
      discardPlan: true,
      regenerateOutline: true,
    })
    expect(result.sessionUpdate.outlineRegenAttempts).toBe(1)
    const feedback = result.sessionUpdate.zeroProgressOutlineRejection!
    expect(feedback.narrativeProgress).toHaveLength(3)
    const prompt = buildZeroProgressRejectionSection({ zeroProgressRejection: feedback })
    expect(prompt).toContain('结构事件数量不能替代情节推进')
    expect(prompt).not.toContain('全部为零')
  })

  it('replans stagnation together with record omissions instead of hiding the stalled window', async () => {
    const { ctx, deps } = setup()
    const omission = {
      id: 'missing',
      ruleId: 'narrative.omission',
      type: 'consistency' as const,
      severity: 'error' as const,
      source: 'narrative_audit' as const,
      retryStrategy: 'draft' as const,
      description: '缺失登记',
    }
    ctx.pendingIssues.push(omission)
    const result = await decideNextStep(ctx, deps)
    expect(result.step).toMatchObject({
      kind: 'draft_chapter',
      regenerateOutline: true,
      feedbackIssues: expect.arrayContaining([omission]),
    })
  })

  it('does not bypass manual review when a stalled window has an authority conflict', async () => {
    const { ctx, deps } = setup()
    ctx.pendingIssues.push({
      id: 'conflict',
      ruleId: 'narrative.contradiction',
      type: 'consistency',
      severity: 'error',
      source: 'narrative_audit',
      retryStrategy: 'manual',
      description: '权威冲突',
    })
    expect((await decideNextStep(ctx, deps)).step.kind).toBe('request_rewrite')
  })

  it('shares the existing bounded outline regeneration budget and stops when exhausted', async () => {
    const { ctx, deps } = setup()
    ctx.session.outlineRegenAttempts = 2
    expect((await decideNextStep(ctx, deps)).step).toMatchObject({
      kind: 'request_rewrite',
      reason: 'zero_progress_stall',
    })
  })

  it.each(['advancing', 'transition', 'uncertain'] as const)(
    'allows a window interrupted by %s',
    async (verdict) => {
      const { ctx, deps, report } = setup()
      report.progress[1]!.verdict = verdict
      expect((await decideNextStep(ctx, deps)).step.kind).toBe('finalize_chapter')
    }
  )

  it('does not consume stale content-bound assessments', async () => {
    const { ctx, deps } = setup()
    ctx.session.validatedContentHash = 'changed'
    expect((await decideNextStep(ctx, deps)).step.kind).not.toBe('draft_chapter')
    // The graph-level binding check separately forces revalidation before calling routing.
  })

  it('report mode never triggers replanning or patch-fix even with located findings', async () => {
    const { ctx, deps, report, planningConfig } = setup()
    report.mode = 'report'
    planningConfig.narrativeAuditMode = 'report'
    report.findings = [
      {
        kind: 'prose_artifact',
        factIndexes: [],
        recordIndexes: [],
        evidence: [{ chapterIndex: 2, paragraphIndex: 0 }],
        confidence: 'high',
        explanation: '编辑说明混入',
        repairTarget: 'current_prose',
        suggestion: '核查正文',
      },
    ]
    ctx.pendingIssues = narrativeAuditIssues(report)
    expect((await decideNextStep(ctx, deps)).step.kind).toBe('finalize_chapter')
  })

  it('rebuilds the plan for missing facts without unbounded retries', async () => {
    const { ctx, deps, report } = setup()
    report.findings = [
      {
        kind: 'omission',
        factIndexes: [],
        recordIndexes: [],
        evidence: [{ chapterIndex: 2, paragraphIndex: 0 }],
        confidence: 'high',
        explanation: '正文死亡未登记',
        repairTarget: 'current_prose',
        suggestion: '登记事实，重新检查',
      },
    ]
    ctx.pendingIssues = narrativeAuditIssues(report)
    expect((await decideNextStep(ctx, deps)).step).toMatchObject({
      kind: 'draft_chapter',
      discardPlan: true,
    })
    ctx.session.errorRewriteAttempts = DEFAULT_CHAPTER_PLANNING_CONFIG.maxErrorRewriteAttempts
    expect((await decideNextStep(ctx, deps)).step).toMatchObject({
      kind: 'request_rewrite',
      reason: 'max_rewrite_attempts',
    })
  })
})
