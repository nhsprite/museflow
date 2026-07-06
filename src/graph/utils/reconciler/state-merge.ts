import type { StoryState, PendingTask, CanonicalFact } from '../../../types/story-state.js'
import { createEmptyStoryState } from '../../../storage/meta/stores/story-state.js'
import { mergeCanonicalRecords, canonicalizeItemName } from '../../../utils/items.js'
import { generateId } from '../../../utils/id.js'
import { findMatchingKey, findMatchingKeys } from './format.js'
import { isCharacterSubject } from './timeline.js'

/**
 * 将作者通过 CLI 做出的裁决（source='author' 的 overrides）应用到 storyState。
 *
 * 这是通用机制：它根据 override 的 attribute 更新角色/物品位置或状态，
 * 并同步更新 canonicalFacts，使后续 agent 把作者裁决视为权威事实。
 */
export function applyAuthorOverrides(state: StoryState): StoryState {
  const overrides = state.overrides?.filter((o) => o.source === 'author') ?? []
  if (overrides.length === 0) return state

  const result: StoryState = { ...state }
  const canonicalFacts = [...(state.canonicalFacts ?? [])]

  for (const override of overrides) {
    const { subject, attribute, newValue, chapterIndex } = override

    if (attribute === 'location') {
      const characterKey = findMatchingKey(result.characterLocations, subject)
      if (characterKey) {
        result.characterLocations[characterKey] = newValue
      }
      for (const itemKey of findMatchingKeys(result.keyItemsLocation, subject)) {
        result.keyItemsLocation[itemKey] = newValue
      }
    } else if (attribute === 'status') {
      const characterKey = findMatchingKey(result.characterStatus, subject)
      if (characterKey) {
        result.characterStatus[characterKey] = newValue
      }
      for (const itemKey of findMatchingKeys(result.keyItemsState, subject)) {
        result.keyItemsState[itemKey] = newValue
      }
    }

    const existingIndex = canonicalFacts.findIndex(
      (f) => f.subject === subject && f.attribute === attribute && f.retiredIn === undefined
    )
    const fact: CanonicalFact = {
      id: existingIndex >= 0 ? canonicalFacts[existingIndex]!.id : generateId('fact'),
      subject,
      attribute,
      value: newValue,
      establishedIn: chapterIndex,
      confidence: 'high',
      source: 'author_override',
      supersedes:
        existingIndex >= 0
          ? [
              ...(canonicalFacts[existingIndex]!.supersedes ?? []),
              {
                chapter: canonicalFacts[existingIndex]!.establishedIn,
                oldValue: canonicalFacts[existingIndex]!.value,
              },
            ]
          : [{ chapter: Math.max(0, chapterIndex - 1), oldValue: override.oldValue }],
    }
    if (existingIndex >= 0) {
      const existing = canonicalFacts[existingIndex]!
      canonicalFacts[existingIndex] = { ...existing, retiredIn: chapterIndex }
    }
    canonicalFacts.push(fact)
  }

  result.canonicalFacts = canonicalFacts
  return result
}

export function mergeStoryState(existing: StoryState | null, delta: StoryState): StoryState {
  const base = existing ?? createEmptyStoryState()
  const safeDelta = {
    characterLocations: delta.characterLocations ?? {},
    characterStatus: delta.characterStatus ?? {},
    keyItemsLocation: delta.keyItemsLocation ?? {},
    keyItemsState: delta.keyItemsState ?? {},
    activePlots: delta.activePlots ?? [],
    revealedSecrets: delta.revealedSecrets ?? [],
    pendingTasks: delta.pendingTasks ?? [],
    supersededFacts: delta.supersededFacts ?? [],
    canonicalFacts: delta.canonicalFacts ?? [],
    overrides: delta.overrides ?? [],
    currentScene: delta.currentScene,
    storyTime: delta.storyTime,
    chapterHandoff: delta.chapterHandoff,
  }

  const mergedLocations = { ...base.characterLocations }
  for (const [char, loc] of Object.entries(safeDelta.characterLocations)) {
    if (loc) {
      mergedLocations[char] = loc
    }
  }

  const mergedStatus = { ...base.characterStatus }
  for (const [char, status] of Object.entries(safeDelta.characterStatus)) {
    if (status) {
      mergedStatus[char] = status
    }
  }

  const mergedItems = mergeCanonicalRecords(base.keyItemsLocation, safeDelta.keyItemsLocation)
  const mergedItemStates = mergeCanonicalRecords(base.keyItemsState, safeDelta.keyItemsState)

  const mergedPlots = [...base.activePlots]
  for (const plot of safeDelta.activePlots) {
    if (plot && !mergedPlots.includes(plot)) {
      mergedPlots.push(plot)
    }
  }

  const mergedSecrets = [...base.revealedSecrets]
  for (const secret of safeDelta.revealedSecrets) {
    if (secret && !mergedSecrets.includes(secret)) {
      mergedSecrets.push(secret)
    }
  }

  const mergedSuperseded = [...(base.supersededFacts ?? [])]
  for (const fact of safeDelta.supersededFacts) {
    const isDuplicate = mergedSuperseded.some(
      (existing) => existing.subject === fact.subject && existing.oldFact === fact.oldFact
    )
    if (!isDuplicate) {
      mergedSuperseded.push(fact)
    }
  }

  const mergedCanonicalFacts = [...(base.canonicalFacts ?? [])]
  for (const fact of safeDelta.canonicalFacts) {
    const sameValueIndex = mergedCanonicalFacts.findIndex(
      (existing) =>
        existing.subject === fact.subject &&
        existing.attribute === fact.attribute &&
        existing.value === fact.value
    )
    if (sameValueIndex >= 0) {
      if (
        (fact.establishedIn ?? -1) >= (mergedCanonicalFacts[sameValueIndex]!.establishedIn ?? -1)
      ) {
        mergedCanonicalFacts[sameValueIndex] = fact
      }
      continue
    }

    const sameSubjectIndex = mergedCanonicalFacts.findIndex(
      (existing) =>
        existing.subject === fact.subject &&
        existing.attribute === fact.attribute &&
        existing.retiredIn === undefined
    )
    if (sameSubjectIndex >= 0) {
      const existing = mergedCanonicalFacts[sameSubjectIndex]!
      mergedCanonicalFacts[sameSubjectIndex] = { ...existing, retiredIn: fact.establishedIn }
    }
    mergedCanonicalFacts.push(fact)
  }

  const mergedPendingTasks = mergePendingTasks(base.pendingTasks, safeDelta.pendingTasks)

  const result: StoryState = {
    characterLocations: mergedLocations,
    characterStatus: mergedStatus,
    keyItemsLocation: mergedItems,
    keyItemsState: mergedItemStates,
    activePlots: mergedPlots,
    revealedSecrets: mergedSecrets,
    pendingTasks: mergedPendingTasks,
    currentScene: safeDelta.currentScene || base.currentScene,
    storyTime: safeDelta.storyTime || base.storyTime,
  }

  const mergedChapterHandoff = safeDelta.chapterHandoff ?? base.chapterHandoff
  if (mergedChapterHandoff) {
    result.chapterHandoff = mergedChapterHandoff
  }

  if (mergedSuperseded.length > 0) {
    result.supersededFacts = mergedSuperseded
  }

  if (mergedCanonicalFacts.length > 0) {
    result.canonicalFacts = mergedCanonicalFacts
  }

  const mergedOverrides = [...(base.overrides ?? [])]
  for (const override of safeDelta.overrides) {
    const isDuplicate = mergedOverrides.some((existing) => existing.id === override.id)
    if (!isDuplicate) {
      mergedOverrides.push(override)
    }
  }
  if (mergedOverrides.length > 0) {
    result.overrides = mergedOverrides
  }

  return result
}

function mergePendingTasks(existing: PendingTask[], delta: PendingTask[]): PendingTask[] {
  const safeDelta = delta ?? []
  const safeExisting = existing ?? []
  if (safeDelta.length === 0) return safeExisting
  const result = [...safeExisting]
  for (const task of safeDelta) {
    const index = result.findIndex(
      (t) =>
        t.id === task.id || (t.assignee === task.assignee && t.description === task.description)
    )
    if (index >= 0) {
      result[index] = { ...result[index], ...task }
    } else {
      result.push(task)
    }
  }
  return result
}

export function applyCanonicalFactsToState(
  state: StoryState,
  characters?: Array<{ name: string }>
): StoryState {
  const result: StoryState = { ...state }
  const facts = state.canonicalFacts ?? []

  for (const fact of facts) {
    if (fact.attribute === 'location') {
      if (isCharacterSubject(fact.subject, characters)) {
        result.characterLocations[fact.subject] = fact.value
      } else {
        result.keyItemsLocation[fact.subject] = fact.value
      }

      const canonical = canonicalizeItemName(fact.subject)
      for (const key of Object.keys(result.keyItemsLocation)) {
        if (canonicalizeItemName(key) === canonical) {
          result.keyItemsLocation[key] = fact.value
        }
      }
      for (const key of Object.keys(result.characterLocations)) {
        if (canonicalizeItemName(key) === canonical) {
          result.characterLocations[key] = fact.value
        }
      }
    }

    if (fact.attribute === 'status') {
      if (isCharacterSubject(fact.subject, characters)) {
        result.characterStatus[fact.subject] = fact.value
      } else {
        result.keyItemsState[fact.subject] = fact.value
      }

      const canonical = canonicalizeItemName(fact.subject)
      for (const key of Object.keys(result.keyItemsState)) {
        if (canonicalizeItemName(key) === canonical) {
          result.keyItemsState[key] = fact.value
        }
      }
      for (const key of Object.keys(result.characterStatus)) {
        if (canonicalizeItemName(key) === canonical) {
          result.characterStatus[key] = fact.value
        }
      }
    }
  }

  return result
}
