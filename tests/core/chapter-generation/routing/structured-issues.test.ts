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
