import { describe, it, expect } from 'vitest'
import {
  buildStructuredIssues,
  STRUCTURED_ISSUE_TYPES,
} from '../../../../src/core/chapter-generation/routing/structured-issues.js'
import type { StructuredValidationResult } from '../../../../src/story-memory/validator.js'

function makeResult(
  overrides: Partial<StructuredValidationResult> = {}
): StructuredValidationResult {
  return {
    // 非空 expectedEvents 抑制与本测试无关的 structured.zero-event-chapter 信号，
    // 让各断言聚焦被测字段；零事件信号有专属测试覆盖。
    expectedEvents: [
      {
        id: 'evt-expected-default',
        type: 'character-location',
        characterId: 'c-default',
        locationId: 'l-default',
        chapterIndex: 0,
        source: 'outline',
      },
    ],
    actualEvents: [],
    missingEvents: [],
    unexpectedEvents: [],
    eventsMissingEvidence: [],
    eventsWithInvalidEvidence: [],
    eventsWithInvalidForeshadowDeadline: [],
    unfulfilledRequiredForeshadows: [],
    overdueForeshadows: [],
    falseFulfillments: [],
    foreshadowFulfillmentRejections: [],
    plotAdvanceRejections: [],
    unclaimedMandatoryBeats: [],
    claimedButUnprovenBeats: [],
    stateConflicts: [],
    finalStateMismatches: [],
    finalStateUncorroborated: [],
    autoCompletedEvents: [],
    droppedUnauthorizedPlotAdvanceEvents: [],
    ...overrides,
  }
}

describe('buildStructuredIssues final-state mismatches', () => {
  it('converts an uncorroborated declaration into an event_missing warning issue', () => {
    const result = makeResult({
      finalStateUncorroborated: [
        {
          entityId: 'i-box',
          attribute: 'location',
          declaredValue: 'loc-drawer-right',
          actualValue: null,
        },
      ],
    })
    const issues = buildStructuredIssues(result, 24)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      ruleId: 'structured.final-state-uncorroborated',
      type: 'event_missing',
      severity: 'warning',
    })
    expect(issues[0]?.description).toContain('i-box')
    expect(issues[0]?.description).toContain('loc-drawer-right')
    expect(issues[0]?.description).toContain('未被本章事件流支撑')
    expect(STRUCTURED_ISSUE_TYPES.has(issues[0]!.type)).toBe(true)
  })

  it('converts a value mismatch into an event_missing error issue mentioning both values', () => {
    const result = makeResult({
      finalStateMismatches: [
        {
          entityId: 'i-box',
          attribute: 'location',
          declaredValue: 'loc-drawer-right',
          actualValue: 'loc-drawer-deep',
        },
      ],
    })
    const issues = buildStructuredIssues(result, 24)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      ruleId: 'structured.final-state-mismatch',
      type: 'event_missing',
      severity: 'error',
    })
    expect(issues[0]?.description).toContain('loc-drawer-right')
    expect(issues[0]?.description).toContain('loc-drawer-deep')
  })

  it('produces no issues when there are no mismatches', () => {
    expect(buildStructuredIssues(makeResult(), 0)).toEqual([])
    expect(buildStructuredIssues(undefined, 0)).toEqual([])
  })
})

describe('buildStructuredIssues foreshadow semantic rejections', () => {
  it('keeps the existing blocking issue code and includes the typed rejection reason', () => {
    const issues = buildStructuredIssues(
      makeResult({
        falseFulfillments: ['fs-a'],
        foreshadowFulfillmentRejections: [
          {
            foreshadowId: 'fs-a',
            evidenceParagraphIndex: 2,
            verdict: 'uncertain',
            reason: '证据不足以确定是否完成回收。',
          },
        ],
      }),
      4
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      ruleId: 'structured.foreshadow-false-fulfillment',
      type: 'foreshadow_false_fulfillment',
      severity: 'error',
      source: 'foreshadowing',
    })
    expect(issues[0]?.description).toContain('fs-a')
    expect(issues[0]?.description).toContain('uncertain')
    expect(issues[0]?.description).toContain('证据不足以确定是否完成回收。')
  })
})

describe('buildStructuredIssues plot semantic rejections', () => {
  it('turns a rejected plot event into one blocking beat issue with the verifier reason', () => {
    const issues = buildStructuredIssues(
      makeResult({
        claimedButUnprovenBeats: ['beat-a'],
        plotAdvanceRejections: [
          {
            eventId: 'evt-a',
            beatId: 'beat-a',
            evidenceParagraphIndex: 1,
            verdict: 'not_proven',
            reason: '证据没有呈现要求的不可逆变化。',
          },
        ],
      }),
      2
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      ruleId: 'structured.beat-unproven',
      type: 'beat_unproven',
      severity: 'error',
      subject: 'beat-a',
    })
    expect(issues[0]?.description).toContain('evt-a')
    expect(issues[0]?.description).toContain('not_proven')
    expect(issues[0]?.description).toContain('证据没有呈现要求的不可逆变化。')
    expect(issues[0]?.suggestion).toContain('可观察的事件场景')
    expect(issues[0]?.suggestion).toContain('@pN')
  })

  it('attaches an actionable suggestion when a claimed beat has no matching event', () => {
    const issues = buildStructuredIssues(makeResult({ claimedButUnprovenBeats: ['beat-b'] }), 2)

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      ruleId: 'structured.beat-unproven',
      type: 'beat_unproven',
      severity: 'error',
      subject: 'beat-b',
    })
    expect(issues[0]?.suggestion).toContain('可观察事件场景')
    expect(issues[0]?.suggestion).toContain('plot-advance')
  })
})

describe('buildStructuredIssues zero-event chapter signal (C.2.1)', () => {
  it('emits a warning when filtered draft events and expected events are both empty', () => {
    const issues = buildStructuredIssues(makeResult({ expectedEvents: [] }), 7)

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      ruleId: 'structured.zero-event-chapter',
      type: 'event_missing',
      severity: 'warning',
      source: 'outline_compliance',
    })
    expect(STRUCTURED_ISSUE_TYPES.has(issues[0]!.type)).toBe(true)
  })

  it('does not emit the warning when expected events exist or draft events survive filtering', () => {
    expect(buildStructuredIssues(makeResult(), 7)).toEqual([])

    const withDraftEvent = makeResult({
      expectedEvents: [],
      actualEvents: [
        {
          id: 'evt-draft',
          type: 'character-location',
          characterId: 'c-1',
          locationId: 'l-1',
          chapterIndex: 7,
          source: 'chapter',
        },
      ],
    })
    expect(buildStructuredIssues(withDraftEvent, 7)).toEqual([])
  })

  it('ignores dropped unauthorized plot-advance events when judging emptiness', () => {
    const droppedEvent = {
      id: 'evt-dropped',
      type: 'plot-advance' as const,
      plotId: 'act-1',
      beatId: 'A1-M1',
      chapterIndex: 7,
      source: 'chapter' as const,
    }
    const issues = buildStructuredIssues(
      makeResult({
        expectedEvents: [],
        actualEvents: [droppedEvent],
        droppedUnauthorizedPlotAdvanceEvents: [droppedEvent],
      }),
      7
    )

    expect(issues.map((issue) => issue.ruleId)).toContain('structured.zero-event-chapter')
  })
})

describe('buildStructuredIssues mandatory-beat-unclaimed (C.2.1)', () => {
  const unclaimedResult = () =>
    makeResult({
      unclaimedMandatoryBeats: ['A2-M1', 'A2-M2'],
      claimedMandatoryBeatIds: [],
    })

  it('emits error issues for unclaimed current-act mandatory beats when a claim is required', () => {
    const issues = buildStructuredIssues(unclaimedResult(), 5, {
      requireMandatoryBeatClaim: true,
    })

    expect(issues).toHaveLength(2)
    expect(issues[0]).toMatchObject({
      ruleId: 'structured.mandatory-beat-unclaimed',
      type: 'beat_unproven',
      severity: 'error',
      subject: 'A2-M1',
      source: 'outline_compliance',
    })
    expect(issues[1]?.subject).toBe('A2-M2')
    expect(STRUCTURED_ISSUE_TYPES.has(issues[0]!.type)).toBe(true)
  })

  it('stays silent without the claim requirement, when beats are claimed, or when none are pending', () => {
    // 未注入强制认领义务：正常配速章节零认领是合法的，不报 error。
    expect(buildStructuredIssues(unclaimedResult(), 5)).toEqual([])

    // 本章已认领 mandatory beat：无零认领问题。
    expect(
      buildStructuredIssues(
        makeResult({ unclaimedMandatoryBeats: ['A2-M2'], claimedMandatoryBeatIds: ['A2-M1'] }),
        5,
        { requireMandatoryBeatClaim: true }
      )
    ).toEqual([])

    // 当前幕无待消费 mandatory beat：无信号。
    expect(
      buildStructuredIssues(
        makeResult({ unclaimedMandatoryBeats: [], claimedMandatoryBeatIds: [] }),
        5,
        {
          requireMandatoryBeatClaim: true,
        }
      )
    ).toEqual([])
  })
})

describe('buildStructuredIssues unauthorized plot-advance drops', () => {
  it('turns a dropped unauthorized plot-advance event into a non-blocking warning issue', () => {
    const issues = buildStructuredIssues(
      makeResult({
        droppedUnauthorizedPlotAdvanceEvents: [
          {
            id: 'evt-x',
            type: 'plot-advance',
            plotId: 'act-5',
            beatId: 'A5-M2',
            chapterIndex: 51,
            source: 'chapter',
            evidence: { paragraphIndex: 4 },
          },
        ],
      }),
      51
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      ruleId: 'structured.plot-advance-unauthorized-dropped',
      type: 'event_unexpected',
      severity: 'warning',
      subject: 'A5-M2',
    })
    expect(issues[0]?.description).toContain('evt-x')
    expect(issues[0]?.description).toContain('A5-M2')
    expect(issues[0]?.description).toContain('丢弃')
    expect(STRUCTURED_ISSUE_TYPES.has(issues[0]!.type)).toBe(true)
  })

  it('still converts unauthorized non-plot-advance events into blocking errors', () => {
    const issues = buildStructuredIssues(
      makeResult({
        unexpectedEvents: [
          {
            id: 'evt-loc',
            type: 'character-location',
            characterId: 'c-1',
            locationId: 'l-1',
            chapterIndex: 51,
            source: 'chapter',
          },
        ],
      }),
      51
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      ruleId: 'structured.event-unexpected',
      type: 'event_unexpected',
      severity: 'error',
    })
  })
})
