import type {
  StoryState,
  Conflict,
  ConflictType,
  ConflictSeverity,
  CanonicalFact,
  ReconciliationReport,
  StateOverride,
  SupersededFact,
  FactAttribute,
} from '../../../types/story-state.js'
import { labelFromFactAttribute } from '../../../types/story-state.js'
import type { ModelProvider } from '../../../model/provider.js'
import {
  batchExtractEntityChanges,
  batchDetectTimeJumps,
  batchJudgeBlockingConflictDescriptions,
} from '../../../utils/context-judge.js'
import { generateId } from '../../../utils/id.js'
import { applyCanonicalFactsToState } from './state-merge.js'

function generateConflictId(subject: string, attribute: FactAttribute, index: number): string {
  return `${subject}:${attribute}:${index}`
}

function createConflict(
  subject: string,
  attribute: FactAttribute,
  oldValue: string,
  newValue: string,
  outlineReference: string,
  index: number,
  severity: 'auto' | 'warning' | 'blocking' = 'auto'
): Conflict {
  return {
    id: generateConflictId(subject, attribute, index),
    type: 'retcon',
    subject,
    attribute,
    oldValue,
    newValue,
    outlineReference,
    severity,
    description: `大纲将「${subject}」的${labelFromFactAttribute(attribute)}从「${oldValue}」更新为「${newValue}」`,
  }
}

async function detectEntityConflictsWithLLM<T extends Record<string, string>>(
  entities: T,
  outline: string,
  attribute: FactAttribute,
  severity: 'auto' | 'warning',
  provider: ModelProvider
): Promise<Conflict[]> {
  const items: Array<{
    text: string
    subject: string
    currentValue: string
    outlineReference: string
  }> = []

  for (const [subject, currentValue] of Object.entries(entities)) {
    items.push({
      text: outline,
      subject,
      currentValue,
      outlineReference: outline,
    })
  }

  if (items.length === 0) return []

  const changes = await batchExtractEntityChanges(
    provider,
    items.map((i) => ({ text: i.text, subject: i.subject, attribute }))
  )

  const conflicts: Conflict[] = []
  let index = 0
  for (let i = 0; i < items.length; i++) {
    const change = changes[i]
    const item = items[i]!
    if (!change || change.skip) continue
    if (change.changeKind !== 'explicit_change') continue

    const newValue = attribute === 'location' ? change.location : change.state
    if (!newValue || newValue === item.currentValue) continue

    conflicts.push(
      createConflict(
        item.subject,
        attribute,
        item.currentValue,
        newValue,
        item.outlineReference,
        index++,
        severity
      )
    )
  }

  return conflicts
}

export async function detectItemLocationConflicts(
  state: StoryState,
  outline: string,
  provider: ModelProvider
): Promise<Conflict[]> {
  return detectEntityConflictsWithLLM(state.keyItemsLocation, outline, 'location', 'auto', provider)
}

export async function detectItemStateConflicts(
  state: StoryState,
  outline: string,
  provider: ModelProvider
): Promise<Conflict[]> {
  return detectEntityConflictsWithLLM(state.keyItemsState, outline, 'status', 'auto', provider)
}

export async function detectCharacterLocationConflicts(
  state: StoryState,
  outline: string,
  provider: ModelProvider
): Promise<Conflict[]> {
  return detectEntityConflictsWithLLM(
    state.characterLocations,
    outline,
    'location',
    'auto',
    provider
  )
}

export async function detectCharacterStatusConflicts(
  state: StoryState,
  outline: string,
  provider: ModelProvider
): Promise<Conflict[]> {
  return detectEntityConflictsWithLLM(state.characterStatus, outline, 'status', 'warning', provider)
}

export function detectSecretRevealConflicts(state: StoryState, outline: string): Conflict[] {
  void state
  void outline
  return []
}

export async function detectTimeAnchorConflicts(
  state: StoryState,
  outline: string,
  chapterIndex: number,
  provider: ModelProvider
): Promise<Conflict[]> {
  const conflicts: Conflict[] = []
  if (!state.storyTime || chapterIndex <= 0) {
    return conflicts
  }

  const hasJump = await batchDetectTimeJumps(provider, [outline])
  if (!hasJump[0]) return conflicts

  conflicts.push({
    id: `time-jump:${chapterIndex}`,
    type: 'time_jump',
    subject: '叙事时间',
    attribute: 'event',
    oldValue: state.storyTime,
    newValue: '大纲明确时间推进',
    outlineReference: outline.slice(0, 200),
    severity: 'auto',
    description: `大纲明确出现时间推进词，本章时间锚点应相应调整`,
  })

  return conflicts
}

export async function detectAllConflicts(
  state: StoryState,
  outline: string,
  chapterIndex: number,
  provider?: ModelProvider
): Promise<Conflict[]> {
  if (!provider) {
    return []
  }

  const [itemLocation, itemState, characterLocation, characterStatus, secretReveal, timeAnchor] =
    await Promise.all([
      detectItemLocationConflicts(state, outline, provider),
      detectItemStateConflicts(state, outline, provider),
      detectCharacterLocationConflicts(state, outline, provider),
      detectCharacterStatusConflicts(state, outline, provider),
      detectSecretRevealConflicts(state, outline),
      detectTimeAnchorConflicts(state, outline, chapterIndex, provider),
    ])

  return [
    ...itemLocation,
    ...itemState,
    ...characterLocation,
    ...characterStatus,
    ...secretReveal,
    ...timeAnchor,
  ]
}

async function detectContradictions(
  conflicts: Conflict[],
  provider: ModelProvider
): Promise<boolean[]> {
  const descriptions = conflicts.map((c) => c.description)
  const results = await batchJudgeBlockingConflictDescriptions(provider, descriptions)
  return results
}

export async function classifyConflicts(
  conflicts: Conflict[],
  provider?: ModelProvider
): Promise<Conflict[]> {
  let blockingFlags: boolean[] = []
  if (provider && conflicts.length > 0) {
    blockingFlags = await detectContradictions(conflicts, provider)
  }

  return conflicts.map((conflict, index) => {
    const isBlockingContradiction = blockingFlags[index] ?? false

    if (isBlockingContradiction || conflict.type === 'contradiction') {
      return {
        ...conflict,
        type: 'contradiction',
        severity: 'blocking',
      }
    }

    let severity: ConflictSeverity = conflict.severity
    let type: ConflictType = conflict.type

    if (conflict.attribute === 'location') {
      type = 'retcon'
      severity = 'auto'
    } else if (conflict.attribute === 'status') {
      type = 'retcon'
      severity = conflict.severity === 'blocking' ? 'blocking' : 'warning'
    } else if (conflict.type === 'time_jump') {
      severity = 'auto'
    }

    return {
      ...conflict,
      type,
      severity,
    }
  })
}

function buildCharacterAliasMap(characters: Array<{ name: string }>): Map<string, string> {
  const aliasToFull = new Map<string, string>()
  const fullNames = characters.map((c) => c.name).filter(Boolean)

  for (const fullName of fullNames) {
    aliasToFull.set(fullName, fullName)
  }

  return aliasToFull
}

function reconcileStoryStateContent(
  storyState: StoryState,
  outline: string,
  characters: Array<{ name: string }> = []
): StoryState {
  void outline
  const reconciled: StoryState = {
    characterLocations: {},
    characterStatus: {},
    keyItemsLocation: { ...storyState.keyItemsLocation },
    keyItemsState: { ...storyState.keyItemsState },
    activePlots: [...storyState.activePlots],
    revealedSecrets: [],
    pendingTasks: [...(storyState.pendingTasks ?? [])],
    currentScene: storyState.currentScene,
    storyTime: storyState.storyTime,
    ...(storyState.supersededFacts ? { supersededFacts: storyState.supersededFacts } : {}),
    ...(storyState.canonicalFacts ? { canonicalFacts: storyState.canonicalFacts } : {}),
    ...(storyState.overrides ? { overrides: storyState.overrides } : {}),
  }

  const aliasMap = buildCharacterAliasMap(characters)

  const statusMap = new Map<string, string>()
  for (const [char, status] of Object.entries(storyState.characterStatus)) {
    const normalized = aliasMap.get(char) || char
    statusMap.set(normalized, status)
  }
  reconciled.characterStatus = Object.fromEntries(statusMap)

  const locMap = new Map<string, string>()
  for (const [char, loc] of Object.entries(storyState.characterLocations)) {
    const normalized = aliasMap.get(char) || char
    locMap.set(normalized, loc)
  }
  reconciled.characterLocations = Object.fromEntries(locMap)

  for (const secret of storyState.revealedSecrets) {
    reconciled.revealedSecrets.push(secret)
  }

  return reconciled
}

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
    (f) => f.subject === conflict.subject && f.attribute === conflict.attribute
  )
  return {
    id: existing?.id ?? generateId('fact'),
    subject: conflict.subject,
    attribute: conflict.attribute,
    value: conflict.newValue,
    establishedIn: chapterIndex,
    confidence: 'medium',
    source: 'reconciliation',
    supersedes: existing
      ? [
          ...(existing.supersedes ?? []),
          { chapter: existing.establishedIn, oldValue: existing.value },
        ]
      : [{ chapter: Math.max(0, chapterIndex - 1), oldValue: conflict.oldValue }],
  }
}

function generateSupersededFact(conflict: Conflict, chapterIndex: number): SupersededFact {
  const chapterNumber = chapterIndex + 1
  return {
    subject: conflict.subject,
    oldFact: `${labelFromFactAttribute(conflict.attribute)}：${conflict.oldValue}`,
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

    if (
      conflict.type === 'retcon' &&
      (conflict.attribute === 'location' || conflict.attribute === 'status')
    ) {
      autoResolved.push(conflict)
      const fact = generateCanonicalFact(conflict, chapterIndex, canonicalFacts)
      const existingIndex = canonicalFacts.findIndex(
        (f) =>
          f.subject === fact.subject && f.attribute === fact.attribute && f.retiredIn === undefined
      )
      if (existingIndex >= 0) {
        const existing = canonicalFacts[existingIndex]!
        canonicalFacts[existingIndex] = { ...existing, retiredIn: chapterIndex }
      }
      canonicalFacts.push(fact)
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
    .filter((c) => c.severity === 'blocking' || c.severity === 'warning')
    .map((c) => generateOverrideSuggestion(c, chapterIndex))
}

export function conflictIsDecided(
  conflict: Conflict,
  authorDecisions: Record<string, 'outline' | 'canonical'> | undefined
): boolean {
  if (!authorDecisions) return false
  return authorDecisions[conflict.id] !== undefined
}

export async function reconcileStoryState(
  storyState: StoryState,
  outline: string,
  characters: Array<{ name: string }> = [],
  chapterIndex = 0,
  provider?: ModelProvider
): Promise<ReconciliationReport> {
  const rawConflicts = await detectAllConflicts(storyState, outline, chapterIndex, provider)
  const classified = await classifyConflicts(rawConflicts, provider)
  const {
    state: preReconciled,
    autoResolved,
    remaining,
    canonicalFacts,
    supersededFacts,
  } = autoReconcile(classified, storyState, chapterIndex)

  const reconciled = reconcileStoryStateContent(preReconciled, outline, characters)
  reconciled.canonicalFacts = canonicalFacts
  reconciled.supersededFacts = supersededFacts

  const authoritativeState = applyCanonicalFactsToState(reconciled, characters)

  return {
    state: authoritativeState,
    conflicts: remaining,
    autoResolved,
    requiresAuthorDecision: remaining.filter((c) => c.severity === 'blocking'),
    suggestedOverrides: generateOverrideSuggestions(remaining, chapterIndex),
  }
}
