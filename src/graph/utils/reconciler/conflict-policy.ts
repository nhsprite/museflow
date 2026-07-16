import type {
  CanonicalFact,
  Conflict,
  ConflictSeverity,
  FactAttribute,
} from '../../../types/story-state.js'

const TRANSITION_ATTRIBUTES: ReadonlySet<FactAttribute> = new Set(['location', 'status', 'holder'])

function isActiveFact(fact: CanonicalFact): boolean {
  return fact.retiredIn === undefined
}

function isTransitionAttribute(attribute: FactAttribute): boolean {
  return TRANSITION_ATTRIBUTES.has(attribute)
}

export function getTransitionFallbackSeverity(attribute: FactAttribute): ConflictSeverity {
  return attribute === 'status' ? 'warning' : 'auto'
}

export function selectActiveConstraintFacts(facts: readonly CanonicalFact[]): CanonicalFact[] {
  return facts.filter(
    (fact) =>
      isActiveFact(fact) &&
      (fact.source === 'author_override' || !isTransitionAttribute(fact.attribute))
  )
}

export function normalizeTransitionConflictSeverity(
  conflict: Pick<Conflict, 'subject' | 'attribute' | 'severity'>,
  facts: readonly CanonicalFact[],
  transitionFallback: ConflictSeverity
): ConflictSeverity {
  if (!isTransitionAttribute(conflict.attribute)) {
    return conflict.severity
  }

  const hasMatchingAuthorOverride = facts.some(
    (fact) =>
      isActiveFact(fact) &&
      fact.source === 'author_override' &&
      fact.subject === conflict.subject &&
      fact.attribute === conflict.attribute
  )

  return hasMatchingAuthorOverride ? conflict.severity : transitionFallback
}
