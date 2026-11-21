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
import { applyEvents, createEmptyStoryMemory } from '../../../../src/story-memory/projector.js'
import type { StoryEvent } from '../../../../src/types/story-memory.js'
import { validateChapterEvents } from '../../../../src/story-memory/validator.js'
import { evaluateChapterIncrement } from '../../../../src/story-memory/increment.js'
import type { ChapterPlan } from '../../../../src/agents/types.js'

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
    protocolVersion: 4,
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
      recording: 'uncertain',
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

function quietProgress() {
  const fixture = setup()
  const { ctx, report } = fixture
  report.progress = report.progress.map((chapter) => ({
    ...chapter,
    verdict: 'advancing',
    dimensions: ['decision'],
    recording: 'not_required',
    explanation: '人物改变了对往事的理解，并作出新的内心选择，无需状态事件。',
  }))
  const memory = createEmptyStoryMemory()
  ctx.storyMemory = memory
  ctx.consecutiveZeroIncrementChapters = 1
  ctx.pendingIssues = []
  ctx.structuredValidationResult = validateChapterEvents(
    memory,
    2,
    { expectedEvents: [] } as unknown as ChapterPlan,
    []
  )
  ctx.structuredValidationResult.increment = evaluateChapterIncrement(2, memory, memory, [])
  return fixture
}

describe('narrative audit routing', () => {
  it('finalizes evidence-backed non-state progress with two structurally empty chapters', async () => {
    const { ctx, deps } = quietProgress()
    const result = await decideNextStep(ctx, deps)
    expect(result.step.kind).toBe('finalize_chapter')
    expect(
      result.processedIssues.some((issue) => issue.ruleId === 'structured.zero-increment-chapter')
    ).toBe(false)
    expect(ctx.structuredValidationResult?.increment?.zeroIncrement).toBe(true)
    expect(ctx.storyMemory?.events).toEqual([])
  })

  it.each(['required', 'uncertain'] as const)(
    'keeps the structural gate when recording is %s',
    async (recording) => {
      const { ctx, deps, report } = quietProgress()
      report.progress[2]!.recording = recording
      const result = await decideNextStep(ctx, deps)
      expect(result.step).toMatchObject({
        kind: 'draft_chapter',
        regenerateOutline: true,
      })
      expect(result.sessionUpdate.zeroProgressOutlineRejection?.currentNarrativeAssessment).toEqual(
        report.progress[2]
      )
      expect(
        buildZeroProgressRejectionSection({
          zeroProgressRejection: result.sessionUpdate.zeroProgressOutlineRejection,
        })
      ).toContain(`recording=${recording}`)
    }
  )

  it.each([
    'stale',
    'report',
    'off',
    'legacy',
    'transition',
    'missing-coverage',
    'uncertain-coverage',
    'weak-coverage',
    'warning',
  ] as const)('cannot bypass the structural gate with %s evidence', async (scenario) => {
    const { ctx, deps, report, planningConfig } = quietProgress()
    if (scenario === 'stale') ctx.session.validatedContentHash = 'new-content'
    if (scenario === 'report') report.mode = planningConfig.narrativeAuditMode = 'report'
    if (scenario === 'off') planningConfig.narrativeAuditMode = 'off'
    if (scenario === 'legacy') (report as any).protocolVersion = 3
    if (scenario === 'transition') {
      report.progress[2]!.verdict = 'transition'
      report.progress[2]!.recording = 'uncertain'
      report.progress[2]!.dimensions = []
    }
    if (
      scenario === 'missing-coverage' ||
      scenario === 'uncertain-coverage' ||
      scenario === 'weak-coverage'
    ) {
      report.facts = [
        {
          kind: 'identity',
          entityId: 'c-1',
          entityName: null,
          attribute: 'identity',
          value: '身份',
          scope: 'current',
          evidenceParagraphs: [0],
        },
      ]
      if (scenario === 'uncertain-coverage' || scenario === 'weak-coverage')
        report.coverage = [
          {
            factIndex: 0,
            verdict: scenario === 'weak-coverage' ? 'unchanged' : 'uncertain',
            recordIndexes: [],
            confidence: 'low',
            explanation: '覆盖不明',
          },
        ]
    }
    if (scenario === 'warning')
      report.findings = [
        {
          kind: 'omission',
          factIndexes: [],
          recordIndexes: [],
          evidence: [{ chapterIndex: 2, paragraphIndex: 0 }],
          confidence: 'medium',
          explanation: '可能漏记',
          repairTarget: 'current_records',
          suggestion: '核对记录',
        },
      ]
    ctx.pendingIssues = narrativeAuditIssues(report)
    expect((await decideNextStep(ctx, deps)).step).toMatchObject({
      kind: 'draft_chapter',
      regenerateOutline: true,
    })
  })

  it('does not exempt missing mandatory claims or unproven beats', async () => {
    const { ctx, deps } = quietProgress()
    ctx.mandatoryBeatHighPressure = true
    ctx.structuredValidationResult!.unclaimedMandatoryBeats = ['A1-M1']
    ctx.structuredValidationResult!.claimedMandatoryBeatIds = []
    const result = await decideNextStep(ctx, deps)
    expect(result.step.kind).not.toBe('finalize_chapter')
    expect(result.processedIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'structured.mandatory-beat-unclaimed',
          severity: 'error',
        }),
      ])
    )
  })

  it('replans a stalled window despite nonzero structural increments', async () => {
    const { ctx, deps } = setup()
    const memory = createEmptyStoryMemory()
    const event: StoryEvent = {
      id: 'register',
      type: 'entity-register',
      entityKind: 'character',
      entityId: 'c-new',
      displayName: '新角色',
      chapterIndex: 2,
      source: 'chapter',
    }
    ctx.structuredValidationResult = validateChapterEvents(
      memory,
      2,
      { expectedEvents: [] } as unknown as ChapterPlan,
      [event]
    )
    ctx.structuredValidationResult.increment = evaluateChapterIncrement(
      2,
      memory,
      applyEvents(memory, [event]),
      [event]
    )
    expect(ctx.structuredValidationResult.increment.zeroIncrement).toBe(false)
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
