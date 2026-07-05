import type {
  StoryState,
  Conflict,
  ConflictType,
  ConflictSeverity,
  CanonicalFact,
  ReconciliationReport,
  StateOverride,
  SupersededFact,
} from '../../../types/story-state.js'
import type { ModelProvider } from '../../../model/provider.js'
import type { ReducedGraphState } from '../../state.js'
import type { StoryMemory, StoryEvent } from '../../../types/story-memory.js'
import {
  batchExtractEntityChanges,
  batchDetectTimeJumps,
  batchJudgeBlockingConflictDescriptions,
} from '../../../utils/context-judge.js'
import { generateId } from '../../../utils/id.js'
import { applyCanonicalFactsToState } from './state-merge.js'

function generateConflictId(subject: string, attribute: string, index: number): string {
  return `${subject}:${attribute}:${index}`
}

function createConflict(
  subject: string,
  attribute: string,
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
    description:
      attribute === '所在位置'
        ? `大纲将「${subject}」的位置从「${oldValue}」更新为「${newValue}」`
        : `大纲将「${subject}」的状态从「${oldValue}」更新为「${newValue}」`,
  }
}

async function detectEntityConflictsWithLLM<T extends Record<string, string>>(
  entities: T,
  outline: string,
  attribute: '所在位置' | '状态',
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

    const newValue = attribute === '所在位置' ? change.location : change.state
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
  return detectEntityConflictsWithLLM(state.keyItemsLocation, outline, '所在位置', 'auto', provider)
}

export async function detectItemStateConflicts(
  state: StoryState,
  outline: string,
  provider: ModelProvider
): Promise<Conflict[]> {
  return detectEntityConflictsWithLLM(state.keyItemsState, outline, '状态', 'auto', provider)
}

export async function detectCharacterLocationConflicts(
  state: StoryState,
  outline: string,
  provider: ModelProvider
): Promise<Conflict[]> {
  return detectEntityConflictsWithLLM(
    state.characterLocations,
    outline,
    '所在位置',
    'auto',
    provider
  )
}

export async function detectCharacterStatusConflicts(
  state: StoryState,
  outline: string,
  provider: ModelProvider
): Promise<Conflict[]> {
  return detectEntityConflictsWithLLM(state.characterStatus, outline, '状态', 'warning', provider)
}

export async function detectEntityConflicts(
  state: ReducedGraphState,
  outlineEvents: StoryEvent[]
): Promise<Conflict[]> {
  if (state.storyMemory) {
    return detectEntityConflictsFromMemory(state.storyMemory, outlineEvents)
  }
  // 保留旧 LLM 路径作为 fallback：无 StoryMemory 时无法结构化比较，返回空
  return []
}

export function detectEntityConflictsFromMemory(
  memory: StoryMemory,
  outlineEvents: StoryEvent[]
): Conflict[] {
  const conflicts: Conflict[] = []
  for (const event of outlineEvents) {
    if (event.type === 'character-location') {
      const current = memory.entities.characters[event.characterId]?.locationId
      if (current !== undefined && current !== event.locationId) {
        conflicts.push({
          id: generateId(),
          type: 'contradiction',
          subject: event.characterId,
          attribute: 'location',
          oldValue: String(current),
          newValue: String(event.locationId),
          outlineReference: '',
          severity: 'warning',
          description: `Character ${event.characterId} location conflict: ${String(current)} -> ${String(event.locationId)}`,
        })
      }
    } else if (event.type === 'item-location') {
      const item = memory.entities.items[event.itemId]
      if (item) {
        if (
          event.holderId !== undefined &&
          item.holderId !== undefined &&
          item.holderId !== event.holderId
        ) {
          conflicts.push({
            id: generateId(),
            type: 'contradiction',
            subject: event.itemId,
            attribute: 'holder',
            oldValue: String(item.holderId),
            newValue: String(event.holderId),
            outlineReference: '',
            severity: 'warning',
            description: `Item ${event.itemId} holder conflict: ${String(item.holderId)} -> ${String(event.holderId)}`,
          })
        }
        if (
          event.locationId !== undefined &&
          item.locationId !== undefined &&
          item.locationId !== event.locationId
        ) {
          conflicts.push({
            id: generateId(),
            type: 'contradiction',
            subject: event.itemId,
            attribute: 'location',
            oldValue: String(item.locationId),
            newValue: String(event.locationId),
            outlineReference: '',
            severity: 'warning',
            description: `Item ${event.itemId} location conflict: ${String(item.locationId)} -> ${String(event.locationId)}`,
          })
        }
      }
    } else if (event.type === 'character-status') {
      const current = memory.entities.characters[event.characterId]?.status[event.attribute]
      if (current !== undefined && JSON.stringify(current) !== JSON.stringify(event.value)) {
        conflicts.push({
          id: generateId(),
          type: 'contradiction',
          subject: event.characterId,
          attribute: event.attribute,
          oldValue: String(current),
          newValue: String(event.value),
          outlineReference: '',
          severity: 'warning',
          description: `Character ${event.characterId} status ${event.attribute} conflict: ${String(current)} -> ${String(event.value)}`,
        })
      }
    } else if (event.type === 'item-state') {
      const current = memory.entities.items[event.itemId]?.state[event.attribute]
      if (current !== undefined && JSON.stringify(current) !== JSON.stringify(event.value)) {
        conflicts.push({
          id: generateId(),
          type: 'contradiction',
          subject: event.itemId,
          attribute: event.attribute,
          oldValue: String(current),
          newValue: String(event.value),
          outlineReference: '',
          severity: 'warning',
          description: `Item ${event.itemId} state ${event.attribute} conflict: ${String(current)} -> ${String(event.value)}`,
        })
      }
    }
  }
  return conflicts
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
    attribute: '推进',
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

    if (conflict.attribute === '所在位置') {
      type = 'retcon'
      severity = 'auto'
    } else if (conflict.attribute === '状态') {
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

    if (
      conflict.type === 'retcon' &&
      (conflict.attribute === '所在位置' || conflict.attribute === '状态')
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
