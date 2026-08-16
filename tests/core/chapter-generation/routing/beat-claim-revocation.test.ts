import { describe, expect, it } from 'vitest'
import {
  dropBeatClaimsFromOutline,
  findPersistentBeatUnprovenBeatIds,
} from '../../../../src/core/chapter-generation/routing/beat-claim-revocation.js'
import {
  decideNextStep,
  MAX_OUTLINE_REGEN_ATTEMPTS,
  buildBeatClaimOutlineRejection,
} from '../../../../src/core/chapter-generation/routing/index.js'
import type {
  RoutingContext,
  RoutingDeps,
} from '../../../../src/core/chapter-generation/routing/types.js'
import type { Issue } from '../../../../src/types/agent.js'
import type { ChapterOutline, StoryArc } from '../../../../src/types/outline.js'
import type { StructuredValidationResult } from '../../../../src/story-memory/validator.js'
import type { ChapterPlanningConfig } from '../../../../src/types/genre.js'
import { DEFAULT_CHAPTER_PLANNING_CONFIG } from '../../../../src/utils/chapter-planning.js'

const planningConfig: ChapterPlanningConfig = {
  ...DEFAULT_CHAPTER_PLANNING_CONFIG,
  downgradeInterpretiveErrors: false,
}

function beatUnprovenIssue(beatId: string, description = '未通过语义验证'): Issue {
  return {
    id: `issue-${beatId}`,
    ruleId: 'structured.beat-unproven',
    type: 'beat_unproven',
    subject: beatId,
    severity: 'error',
    description,
    source: 'outline_compliance',
    retryStrategy: 'draft',
  }
}

describe('findPersistentBeatUnprovenBeatIds', () => {
  it('returns beat ids unproven in both consecutive rounds', () => {
    const previous = [beatUnprovenIssue('A5-M2'), beatUnprovenIssue('A5-M3')]
    const current = [beatUnprovenIssue('A5-M2')]

    expect(findPersistentBeatUnprovenBeatIds(previous, current)).toEqual(['A5-M2'])
  })

  it('returns empty when the previous round has no matching beat failure', () => {
    expect(findPersistentBeatUnprovenBeatIds([], [beatUnprovenIssue('A5-M2')])).toEqual([])
    expect(
      findPersistentBeatUnprovenBeatIds([beatUnprovenIssue('A5-M3')], [beatUnprovenIssue('A5-M2')])
    ).toEqual([])
  })

  it('ignores non-beat issues and deduplicates by beat id', () => {
    const previous = [beatUnprovenIssue('A5-M2')]
    const current: Issue[] = [
      beatUnprovenIssue('A5-M2'),
      beatUnprovenIssue('A5-M2', '另一种描述'),
      { ...beatUnprovenIssue('A5-M2'), type: 'event_missing', subject: 'A5-M2' },
    ]

    expect(findPersistentBeatUnprovenBeatIds(previous, current)).toEqual(['A5-M2'])
  })

  // D.2.1：上一轮的 beat_uncorroborated error 计入「持续未证明」前任，
  // 使佐证重试耗尽后立即进入撤销/大纲重生成路径。
  it('treats a previous beat_uncorroborated error as an unproven predecessor', () => {
    const previous: Issue[] = [
      {
        id: 'issue-uncorroborated-A5-M2',
        ruleId: 'structured.beat-uncorroborated',
        type: 'beat_uncorroborated',
        subject: 'A5-M2',
        severity: 'error',
        description: '未留下结构化痕迹',
        source: 'outline_compliance',
      },
    ]
    expect(findPersistentBeatUnprovenBeatIds(previous, [beatUnprovenIssue('A5-M2')])).toEqual([
      'A5-M2',
    ])
  })

  it('ignores warning-severity beat_uncorroborated issues as predecessors', () => {
    const previous: Issue[] = [
      {
        id: 'issue-uncorroborated-A5-M2',
        ruleId: 'structured.beat-uncorroborated',
        type: 'beat_uncorroborated',
        subject: 'A5-M2',
        severity: 'warning',
        description: '未认领的未佐证进展',
        source: 'outline_compliance',
      },
    ]
    expect(findPersistentBeatUnprovenBeatIds(previous, [beatUnprovenIssue('A5-M2')])).toEqual([])
  })
})

describe('dropBeatClaimsFromOutline', () => {
  const storyArc: StoryArc = {
    totalChapters: 50,
    acts: [
      {
        index: 5,
        startChapter: 46,
        endChapter: 50,
        title: '终幕',
        theme: '主题',
        function: '功能',
        mandatoryBeats: ['节拍一', '节拍二'],
      },
    ],
    keyBeats: [{ id: 'A5-B1', beat: '关键节拍', deadlineAct: 5, required: false }],
  }

  const outline: ChapterOutline[] = [
    { number: 46, title: '静守', description: '二人静守。' },
    {
      number: 47,
      title: '目标章',
      description: '目标章描述。',
      claimedBeats: ['节拍一', '节拍二'],
      claimedMandatoryBeatIds: ['A5-M1', 'A5-M2'],
      claimedBeatIds: ['A5-B1'],
    },
  ]

  it('drops mandatory and key beat claims and rebuilds claimedBeats from the registry', () => {
    const next = dropBeatClaimsFromOutline(outline, 1, ['A5-M2'], storyArc)

    expect(next[1]?.claimedMandatoryBeatIds).toEqual(['A5-M1'])
    expect(next[1]?.claimedBeats).toEqual(['节拍一'])
    expect(next[1]?.claimedBeatIds).toEqual(['A5-B1'])
    expect(outline[1]?.claimedMandatoryBeatIds).toEqual(['A5-M1', 'A5-M2'])
  })

  it('drops key beat claims as well', () => {
    const next = dropBeatClaimsFromOutline(outline, 1, ['A5-B1'], storyArc)

    expect(next[1]?.claimedBeatIds).toEqual([])
    expect(next[1]?.claimedMandatoryBeatIds).toEqual(['A5-M1', 'A5-M2'])
    expect(next[1]?.claimedBeats).toEqual(['节拍一', '节拍二'])
  })

  it('keeps original claimedBeats text when storyArc is unavailable', () => {
    const next = dropBeatClaimsFromOutline(outline, 1, ['A5-M2'], undefined)

    expect(next[1]?.claimedMandatoryBeatIds).toEqual(['A5-M1'])
    expect(next[1]?.claimedBeats).toEqual(['节拍一', '节拍二'])
  })

  it('returns a shallow copy unchanged when there is nothing to drop', () => {
    expect(dropBeatClaimsFromOutline(outline, 1, [], storyArc)).toEqual(outline)
    expect(dropBeatClaimsFromOutline(outline, 9, ['A5-M2'], storyArc)).toEqual(outline)
  })
})

function makeSession(
  overrides: Partial<RoutingContext['session']> = {}
): RoutingContext['session'] {
  return {
    chapterIndex: 45,
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
      isStateCorruptionIssue: () => false,
    },
    fixPolicy: {},
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

describe('decideNextStep beat claim revocation', () => {
  it('revokes a beat claim that stays unproven for two consecutive rounds', async () => {
    const ctx: RoutingContext = {
      session: makeSession({ previousIssues: [beatUnprovenIssue('A5-M2')] }),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult({
        plotAdvanceRejections: [
          {
            eventId: 'evt-1',
            beatId: 'A5-M2',
            evidenceParagraphIndex: 3,
            verdict: 'not_proven',
            reason: '证据段落只描写了静守，没有真相揭开',
          },
        ],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step).toMatchObject({
      kind: 'draft_chapter',
      discardPlan: true,
      revokedBeatClaimIds: ['A5-M2'],
    })
    expect(result.sessionUpdate.forceStructuralRewrite).toBe(true)
    expect(result.sessionUpdate.errorRewriteAttempts).toBe(2)
    if (result.step.kind !== 'draft_chapter') throw new Error('expected draft_chapter')
    const revokedFeedback = result.step.feedbackIssues.find(
      (issue) => issue.type === 'beat_unproven'
    )
    expect(revokedFeedback?.description).toContain('认领已撤销')
    expect(revokedFeedback?.description).toContain('A5-M2')
    expect(revokedFeedback?.description).not.toContain('evt-1')
    // 撤销反馈必须持久化进 processedIssues（会写回 pendingIssues），
    // 否则下一轮起草仍收到「请证明该节拍」的旧反馈，与已摘除认领的大纲矛盾。
    const persistedFeedback = result.processedIssues.find(
      (issue) => issue.type === 'beat_unproven' && issue.subject === 'A5-M2'
    )
    expect(persistedFeedback?.description).toContain('认领已撤销')
  })

  it('keeps plain re-draft when the same beat fails for the first time', async () => {
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult({
        plotAdvanceRejections: [
          {
            eventId: 'evt-1',
            beatId: 'A5-M2',
            evidenceParagraphIndex: 3,
            verdict: 'not_proven',
            reason: '证据不足',
          },
        ],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).toBe('draft_chapter')
    if (result.step.kind !== 'draft_chapter') throw new Error('expected draft_chapter')
    expect(result.step.discardPlan).toBe(false)
    expect(result.step.revokedBeatClaimIds).toBeUndefined()
    expect(result.step.feedbackIssues[0]?.description).toContain('evt-1')
  })

  it('revokes only the persistently unproven beats when several fail', async () => {
    const ctx: RoutingContext = {
      session: makeSession({ previousIssues: [beatUnprovenIssue('A5-M2')] }),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult({
        plotAdvanceRejections: [
          {
            eventId: 'evt-1',
            beatId: 'A5-M2',
            evidenceParagraphIndex: 3,
            verdict: 'not_proven',
            reason: '证据不足',
          },
          {
            eventId: 'evt-2',
            beatId: 'A5-M3',
            evidenceParagraphIndex: 4,
            verdict: 'not_proven',
            reason: '证据不足',
          },
        ],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step).toMatchObject({
      kind: 'draft_chapter',
      discardPlan: true,
      revokedBeatClaimIds: ['A5-M2'],
    })
    if (result.step.kind !== 'draft_chapter') throw new Error('expected draft_chapter')
    const stillPending = result.step.feedbackIssues.find(
      (issue) => issue.type === 'beat_unproven' && issue.subject === 'A5-M3'
    )
    expect(stillPending?.description).toContain('evt-2')
  })

  const highPressureStoryArc: StoryArc = {
    totalChapters: 50,
    acts: [
      {
        index: 5,
        startChapter: 46,
        endChapter: 50,
        title: '终幕',
        theme: '主题',
        function: '功能',
        mandatoryBeats: ['节拍一', '节拍二'],
      },
    ],
    keyBeats: [],
  }

  const highPressureOutline: ChapterOutline[] = Array.from({ length: 46 }, (_, index) => ({
    number: index + 1,
    title: index === 45 ? '静守' : `第${index + 1}章`,
    description: index === 45 ? '二人静守。' : '前章描述。',
  }))

  it('regenerates the outline with prose-stage rejection feedback instead of blocking under high pressure', async () => {
    const ctx: RoutingContext = {
      session: makeSession({
        previousIssues: [beatUnprovenIssue('A5-M2')],
        issueFingerprintHistory: [['fp-1'], ['fp-1']],
      }),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult({
        plotAdvanceRejections: [
          {
            eventId: 'evt-1',
            beatId: 'A5-M2',
            evidenceParagraphIndex: 3,
            verdict: 'not_proven',
            reason: '证据段落只描写了静守，没有真相揭开',
          },
        ],
      }),
      mandatoryBeatHighPressure: true,
      unprovenMandatoryBeatIds: ['A5-M2', 'A5-M3'],
      storyArc: highPressureStoryArc,
      outline: highPressureOutline,
    }

    const result = await decideNextStep(ctx, makeDeps())

    // 高压下不撤销认领、不直接阻断：保留强制认领约束，携带驳回反馈重生成大纲
    expect(result.step).toMatchObject({
      kind: 'draft_chapter',
      discardPlan: true,
      regenerateOutline: true,
      feedbackIssues: [],
    })
    expect(result.sessionUpdate.outlineRegenAttempts).toBe(1)
    expect(result.sessionUpdate.errorRewriteAttempts).toBe(2)
    expect(result.sessionUpdate.forceStructuralRewrite).toBe(true)
    // 大纲前提已变，停滞指纹必须重置，否则新大纲会被旧指纹误判停滞
    expect(result.sessionUpdate.issueFingerprintHistory).toEqual([])

    const rejection = result.sessionUpdate.beatClaimOutlineRejection
    expect(rejection?.rejectedClaims).toHaveLength(1)
    expect(rejection?.rejectedClaims[0]?.beatId).toBe('A5-M2')
    // 节拍文本必须来自注册表，驳回原因来自正文验证 issue
    expect(rejection?.rejectedClaims[0]?.beat).toBe('节拍二')
    expect(rejection?.rejectedClaims[0]?.reason).toContain('没有真相揭开')
    // 高压下强制认领要求随反馈一起注入：必须认领待消费 mandatory beat 之一
    expect(rejection?.requiredClaims?.chaptersRemainingInAct).toBe(4)
    expect(rejection?.requiredClaims?.pendingMandatoryBeats.map((beat) => beat.beatId)).toEqual([
      'A5-M2',
      'A5-M3',
    ])
    expect(rejection?.currentOutline).toEqual({ title: '静守', description: '二人静守。' })
  })

  it('blocks with request_rewrite after outline regeneration attempts are exhausted under high pressure', async () => {
    const ctx: RoutingContext = {
      session: makeSession({
        previousIssues: [beatUnprovenIssue('A5-M2')],
        outlineRegenAttempts: MAX_OUTLINE_REGEN_ATTEMPTS,
      }),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult({
        plotAdvanceRejections: [
          {
            eventId: 'evt-1',
            beatId: 'A5-M2',
            evidenceParagraphIndex: 3,
            verdict: 'not_proven',
            reason: '证据段落只描写了静守，没有真相揭开',
          },
        ],
      }),
      mandatoryBeatHighPressure: true,
      unprovenMandatoryBeatIds: ['A5-M2', 'A5-M3'],
      storyArc: highPressureStoryArc,
      outline: highPressureOutline,
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).toBe('request_rewrite')
    if (result.step.kind !== 'request_rewrite') throw new Error('expected request_rewrite')
    expect(result.step.reason).toBe('mandatory_beat_unproven')
    const blocking = result.step.blockingIssues.find(
      (issue) => issue.ruleId === 'outline.mandatory-beat-unproven-high-pressure'
    )
    expect(blocking?.description).toContain('A5-M2')
    expect(blocking?.description).toContain('不允许撤销认领')
    // 高压阻塞说明必须进入 processedIssues（写回 pendingIssues），让续跑时能展示失败原因
    expect(
      result.processedIssues.some(
        (issue) => issue.ruleId === 'outline.mandatory-beat-unproven-high-pressure'
      )
    ).toBe(true)
  })

  it('still revokes non-mandatory beat claims under high act-boundary pressure', async () => {
    const ctx: RoutingContext = {
      session: makeSession({ previousIssues: [beatUnprovenIssue('A5-B1')] }),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult({
        plotAdvanceRejections: [
          {
            eventId: 'evt-1',
            beatId: 'A5-B1',
            evidenceParagraphIndex: 3,
            verdict: 'not_proven',
            reason: '证据不足',
          },
        ],
      }),
      mandatoryBeatHighPressure: true,
      unprovenMandatoryBeatIds: ['A5-M2', 'A5-M3'],
    }

    const result = await decideNextStep(ctx, makeDeps())

    // A5-B1 不在未消费 mandatory 名单内：高压只拦截 mandatory beat 撤销，
    // key beat 仍按原有机制撤销并重建 plan。
    expect(result.step).toMatchObject({
      kind: 'draft_chapter',
      discardPlan: true,
      revokedBeatClaimIds: ['A5-B1'],
    })
  })
})

function beatUncorroboratedIssue(beatId: string): Issue {
  return {
    id: `issue-uncorroborated-${beatId}`,
    ruleId: 'structured.beat-uncorroborated',
    type: 'beat_uncorroborated',
    subject: beatId,
    severity: 'error',
    description: `mandatory beat ${beatId} 已通过验证但未留下结构化痕迹`,
    source: 'outline_compliance',
    retryStrategy: 'draft',
  }
}

function uncorroboratedEvaluation(beatId: string) {
  return {
    beatId,
    provingEventIds: ['evt-p1'],
    corroboratingEventIds: [] as string[],
    corroboratedByFinalState: false,
    corroborated: false,
  }
}

describe('decideNextStep beat corroboration (D.2.1)', () => {
  const corroborationStoryArc: StoryArc = {
    totalChapters: 50,
    acts: [
      {
        index: 5,
        startChapter: 46,
        endChapter: 50,
        title: '终幕',
        theme: '主题',
        function: '功能',
        mandatoryBeats: ['节拍一', '节拍二'],
      },
    ],
    keyBeats: [],
  }
  const corroborationOutline: ChapterOutline[] = Array.from({ length: 46 }, (_, index) => ({
    number: index + 1,
    title: `第${index + 1}章`,
    description: '章节描述。',
  }))

  it('retries the draft once with beatCorroboration feedback for a claimed uncorroborated beat', async () => {
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult({
        claimedMandatoryBeatIds: ['A5-M2'],
        beatCorroborations: [uncorroboratedEvaluation('A5-M2')],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).toBe('draft_chapter')
    if (result.step.kind !== 'draft_chapter') throw new Error('expected draft_chapter')
    expect(result.step.discardPlan).toBe(false)
    expect(result.step.revokedBeatClaimIds).toBeUndefined()
    const feedback = result.step.feedbackIssues.find(
      (issue) => issue.type === 'beat_uncorroborated'
    )
    expect(feedback?.ruleId).toBe('structured.beat-uncorroborated')
    expect(feedback?.subject).toBe('A5-M2')
    expect(feedback?.severity).toBe('error')
    expect(feedback?.suggestion).toContain('结构化痕迹')
    expect(feedback?.suggestion).toContain('evt-p1')
  })

  it('converts to beat_unproven and revokes the claim when the corroboration retry is exhausted', async () => {
    const ctx: RoutingContext = {
      session: makeSession({ previousIssues: [beatUncorroboratedIssue('A5-M2')] }),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult({
        claimedMandatoryBeatIds: ['A5-M2'],
        beatCorroborations: [uncorroboratedEvaluation('A5-M2')],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    // 重试耗尽：上一轮的 beat_uncorroborated 计入持续未证明前任，
    // 本轮直接走现有撤销路径，不再空转重试。
    expect(result.step).toMatchObject({
      kind: 'draft_chapter',
      discardPlan: true,
      revokedBeatClaimIds: ['A5-M2'],
    })
    if (result.step.kind !== 'draft_chapter') throw new Error('expected draft_chapter')
    const revokedFeedback = result.step.feedbackIssues.find(
      (issue) => issue.type === 'beat_unproven'
    )
    expect(revokedFeedback?.description).toContain('认领已撤销')
  })

  it('regenerates the outline instead of revoking under high act-boundary pressure', async () => {
    const ctx: RoutingContext = {
      session: makeSession({ previousIssues: [beatUncorroboratedIssue('A5-M2')] }),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult({
        claimedMandatoryBeatIds: ['A5-M2'],
        beatCorroborations: [uncorroboratedEvaluation('A5-M2')],
      }),
      mandatoryBeatHighPressure: true,
      unprovenMandatoryBeatIds: ['A5-M2'],
      storyArc: corroborationStoryArc,
      outline: corroborationOutline,
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step).toMatchObject({
      kind: 'draft_chapter',
      discardPlan: true,
      regenerateOutline: true,
    })
    expect(result.sessionUpdate.outlineRegenAttempts).toBe(1)
    const rejection = result.sessionUpdate.beatClaimOutlineRejection
    expect(rejection?.rejectedClaims[0]?.beatId).toBe('A5-M2')
    expect(rejection?.rejectedClaims[0]?.reason).toContain('按未证明处理')
  })

  it('accepts an unclaimed proven-but-uncorroborated beat as progress with a warning only', async () => {
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult({
        claimedMandatoryBeatIds: [],
        beatCorroborations: [uncorroboratedEvaluation('A5-M2')],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    // 未认领但经正文验证成立：作为真实进展接受（warning），不阻塞定稿；
    // 该 beat 在幕关闭复审时仍视为未消费。
    expect(result.step.kind).toBe('finalize_chapter')
    const warning = result.processedIssues.find((issue) => issue.type === 'beat_uncorroborated')
    expect(warning?.severity).toBe('warning')
    expect(warning?.subject).toBe('A5-M2')
  })

  it('raises no issue when the mandatory beat is corroborated', async () => {
    const ctx: RoutingContext = {
      session: makeSession(),
      pendingIssues: [],
      genre: 'general',
      chapterFileExists: true,
      structuredValidationResult: makeStructuredResult({
        claimedMandatoryBeatIds: ['A5-M2'],
        beatCorroborations: [{ ...uncorroboratedEvaluation('A5-M2'), corroborated: true }],
      }),
    }

    const result = await decideNextStep(ctx, makeDeps())

    expect(result.step.kind).toBe('finalize_chapter')
    expect(result.processedIssues.some((issue) => issue.type === 'beat_uncorroborated')).toBe(false)
  })
})

describe('buildBeatClaimOutlineRejection', () => {
  it('falls back to beat id text and omits currentOutline when storyArc/outline are unavailable', () => {
    const rejection = buildBeatClaimOutlineRejection({
      beatIds: ['A5-M2'],
      issues: [],
      storyArc: null,
      outline: undefined,
      chapterIndex: 45,
      pendingMandatoryBeatIds: ['A5-M2'],
    })

    expect(rejection.rejectedClaims[0]?.beat).toBe('A5-M2')
    expect(rejection.rejectedClaims[0]?.reason).toContain('A5-M2')
    expect(rejection.requiredClaims?.pendingMandatoryBeats[0]?.beat).toBe('A5-M2')
    expect(rejection.requiredClaims?.chaptersRemainingInAct).toBe(0)
    expect(rejection.currentOutline).toBeUndefined()
  })
})
