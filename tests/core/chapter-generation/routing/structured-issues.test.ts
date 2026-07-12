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
    unclaimedMandatoryBeats: [],
    claimedButUnprovenBeats: [],
    stateConflicts: [],
    finalStateMismatches: [],
    finalStateUncorroborated: [],
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
    expect(issues[0]).toMatchObject({ type: 'event_missing', severity: 'error' })
    expect(issues[0]?.description).toContain('loc-drawer-right')
    expect(issues[0]?.description).toContain('loc-drawer-deep')
  })

  it('produces no issues when there are no mismatches', () => {
    expect(buildStructuredIssues(makeResult(), 0)).toEqual([])
    expect(buildStructuredIssues(undefined, 0)).toEqual([])
  })
})
