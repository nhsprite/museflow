import type { StoryState, Conflict, CanonicalFact, SupersededFact, StateOverride } from '../../types/story-state.js'
import { canonicalizeItemName } from '../../utils/story-state-validation.js'
import { generateId } from '../../utils/id.js'

export interface ReconcileResult {
  state: StoryState
  autoResolved: Conflict[]
  remaining: Conflict[]
  canonicalFacts: CanonicalFact[]
  supersededFacts: SupersededFact[]
}

function generateCanonicalFact(
  conflict: Conflict,
  chapterIndex: number,
  existingFacts: CanonicalFact[]
): CanonicalFact {
  const existing = existingFacts.find(
    f => f.subject === conflict.subject && f.attribute === conflict.attribute
  )
  const chapterNumber = chapterIndex + 1
  return {
    id: existing?.id ?? generateId('fact'),
    subject: conflict.subject,
    attribute: conflict.attribute,
    value: conflict.newValue,
    establishedIn: chapterNumber,
    supersedes: existing
      ? [...(existing.supersedes ?? []), { chapter: existing.establishedIn, oldValue: existing.value }]
      : [{ chapter: Math.max(1, chapterNumber - 1), oldValue: conflict.oldValue }],
  }
}

function generateSupersededFact(conflict: Conflict, chapterIndex: number): SupersededFact {
  const chapterNumber = chapterIndex + 1
  return {
    subject: conflict.subject,
    oldFact: `${conflict.attribute}：${conflict.oldValue}`,
    reason: `大纲第 ${chapterNumber} 章更新为：${conflict.newValue}`,
    chapterIndex,
  }
}

function generateOverrideSuggestion(conflict: Conflict, chapterIndex: number): StateOverride {
  return {
    id: generateId('override'),
    subject: conflict.subject,
    attribute: conflict.attribute,
    oldValue: conflict.oldValue,
    newValue: conflict.newValue,
    reason: `自动建议：${conflict.description}`,
    source: 'inferred',
    chapterIndex,
    createdAt: Date.now(),
  }
}

export function autoReconcile(
  conflicts: Conflict[],
  state: StoryState,
  chapterIndex: number
): ReconcileResult {
  const autoResolved: Conflict[] = []
  const remaining: Conflict[] = []
  const canonicalFacts: CanonicalFact[] = [...(state.canonicalFacts ?? [])]
  const supersededFacts: SupersededFact[] = [...(state.supersededFacts ?? [])]
  const reconciled: StoryState = { ...state }

  for (const conflict of conflicts) {
    if (conflict.type === 'alias') {
      autoResolved.push(conflict)
      continue
    }

    if (conflict.type === 'time_jump') {
      autoResolved.push(conflict)
      continue
    }

    if (conflict.type === 'retcon' && conflict.attribute === '所在位置') {
      autoResolved.push(conflict)
      const fact = generateCanonicalFact(conflict, chapterIndex, canonicalFacts)
      const existingIndex = canonicalFacts.findIndex(
        f => f.subject === fact.subject && f.attribute === fact.attribute
      )
      if (existingIndex >= 0) {
        canonicalFacts[existingIndex] = fact
      } else {
        canonicalFacts.push(fact)
      }
      supersededFacts.push(generateSupersededFact(conflict, chapterIndex))
      continue
    }

    if (conflict.type === 'retcon' && conflict.attribute === '状态') {
      autoResolved.push(conflict)
      const fact = generateCanonicalFact(conflict, chapterIndex, canonicalFacts)
      const existingIndex = canonicalFacts.findIndex(
        f => f.subject === fact.subject && f.attribute === fact.attribute
      )
      if (existingIndex >= 0) {
        canonicalFacts[existingIndex] = fact
      } else {
        canonicalFacts.push(fact)
      }
      supersededFacts.push(generateSupersededFact(conflict, chapterIndex))
      continue
    }

    if (conflict.type === 'incomplete') {
      remaining.push({ ...conflict, severity: 'warning' })
      continue
    }

    remaining.push(conflict)
  }

  reconciled.canonicalFacts = canonicalFacts
  reconciled.supersededFacts = supersededFacts

  return {
    state: reconciled,
    autoResolved,
    remaining,
    canonicalFacts,
    supersededFacts,
  }
}

export function generateOverrideSuggestions(
  conflicts: Conflict[],
  chapterIndex: number
): StateOverride[] {
  return conflicts
    .filter(c => c.severity === 'blocking' || c.severity === 'warning')
    .map(c => generateOverrideSuggestion(c, chapterIndex))
}

export function applyCanonicalFactsToState(state: StoryState): StoryState {
  const result: StoryState = { ...state }
  const facts = state.canonicalFacts ?? []

  for (const fact of facts) {
    if (fact.attribute === '所在位置') {
      if (result.characterLocations[fact.subject] !== undefined) {
        result.characterLocations[fact.subject] = fact.value
      }
      if (result.keyItemsLocation[fact.subject] !== undefined) {
        result.keyItemsLocation[fact.subject] = fact.value
      }
      const canonical = canonicalizeItemName(fact.subject)
      for (const key of Object.keys(result.keyItemsLocation)) {
        if (canonicalizeItemName(key) === canonical) {
          result.keyItemsLocation[key] = fact.value
        }
      }
    }
    if (fact.attribute === '状态') {
      if (result.characterStatus[fact.subject] !== undefined) {
        result.characterStatus[fact.subject] = fact.value
      }
      if (result.keyItemsState[fact.subject] !== undefined) {
        result.keyItemsState[fact.subject] = fact.value
      }
      const canonical = canonicalizeItemName(fact.subject)
      for (const key of Object.keys(result.keyItemsState)) {
        if (canonicalizeItemName(key) === canonical) {
          result.keyItemsState[key] = fact.value
        }
      }
    }
  }

  return result
}
