import { describe, expect, it } from 'vitest'
import {
  normalizeTransitionConflictSeverity,
  selectActiveConstraintFacts,
} from '../../../src/graph/utils/reconciler/conflict-policy.js'
import type { CanonicalFact, Conflict } from '../../../src/types/story-state.js'

function makeFact(overrides: Partial<CanonicalFact> = {}): CanonicalFact {
  return {
    id: 'fact-1',
    subject: 'c-protagonist',
    attribute: 'status',
    value: 'waiting',
    establishedIn: 4,
    confidence: 'high',
    source: 'reconciliation',
    ...overrides,
  }
}

function makeConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    id: 'conflict-1',
    type: 'contradiction',
    subject: 'c-protagonist',
    attribute: 'status',
    oldValue: 'waiting',
    newValue: 'moving',
    outlineReference: 'outline',
    severity: 'blocking',
    description: 'state transition',
    ...overrides,
  }
}

describe('outline conflict policy', () => {
  it('selects only active durable facts and active author overrides', () => {
    const facts = [
      makeFact({ id: 'retired', attribute: 'identity', retiredIn: 8 }),
      makeFact({ id: 'status-snapshot', attribute: 'status' }),
      makeFact({ id: 'location-snapshot', attribute: 'location' }),
      makeFact({ id: 'holder-snapshot', attribute: 'holder' }),
      makeFact({ id: 'identity', attribute: 'identity' }),
      makeFact({ id: 'author-status', attribute: 'status', source: 'author_override' }),
    ]

    expect(selectActiveConstraintFacts(facts).map((fact) => fact.id)).toEqual([
      'identity',
      'author-status',
    ])
  })

  it('demotes an ordinary transition snapshot to its structured fallback severity', () => {
    const severity = normalizeTransitionConflictSeverity(makeConflict(), [makeFact()], 'warning')

    expect(severity).toBe('warning')
  })

  it('preserves blocking for a matching active author override', () => {
    const severity = normalizeTransitionConflictSeverity(
      makeConflict(),
      [makeFact({ source: 'author_override' })],
      'warning'
    )

    expect(severity).toBe('blocking')
  })

  it('preserves blocking for non-transition attributes', () => {
    const severity = normalizeTransitionConflictSeverity(
      makeConflict({ attribute: 'identity' }),
      [makeFact({ attribute: 'identity' })],
      'warning'
    )

    expect(severity).toBe('blocking')
  })
})
