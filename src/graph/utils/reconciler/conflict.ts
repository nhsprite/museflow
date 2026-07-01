import { logger } from '../../../utils/logger.js'
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
import {
  batchExtractEntityChanges,
  batchDetectTimeJumps,
  batchJudgeBlockingConflictDescriptions,
} from '../../../utils/context-judge.js'
import { isSemanticallyRelated } from '../../../utils/text-similarity.js'
import { generateId } from '../../../utils/id.js'
import { canonicalizeItemName } from '../../../utils/items.js'
import { applyCanonicalFactsToState } from './state-merge.js'

const QUOTE_PAIRS: Array<[string, string]> = [
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['‘', '’'],
  ['"', '"'],
  ["'", "'"],
  ['【', '】'],
  ['《', '》'],
  ['〈', '〉'],
]

function generateConflictId(subject: string, attribute: string, index: number): string {
  return `${subject}:${attribute}:${index}`
}

function escapeRegExp(subject: string): string {
  return subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；])/u)
    .map(s => s.trim())
    .filter(Boolean)
}

function removeQuotedContent(sentence: string): string {
  let result = sentence
  for (const [open, close] of QUOTE_PAIRS) {
    const pattern = new RegExp(
      `${escapeRegExp(open)}[^${escapeRegExp(close)}]*${escapeRegExp(close)}`,
      'gu'
    )
    result = result.replace(pattern, '')
  }
  return result
}

function isMentionedInSentence(sentence: string, subject: string): boolean {
  return sentence.includes(subject) || sentence.includes(canonicalizeItemName(subject))
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

async function detectEntityConflicts<T extends Record<string, string>>(
  entities: T,
  outline: string,
  attribute: '所在位置' | '状态',
  severity: 'auto' | 'warning',
  provider: ModelProvider,
  mentionFilter?: (sentence: string, subject: string) => boolean
): Promise<Conflict[]> {
  const sentences = splitSentences(outline)
  const items: Array<{
    sentence: string
    subject: string
    currentValue: string
    originalSentence: string
  }> = []

  for (const [subject, currentValue] of Object.entries(entities)) {
    for (const sentence of sentences) {
      const isMentioned = mentionFilter
        ? mentionFilter(sentence, subject)
        : sentence.includes(subject)
      if (!isMentioned) continue

      const cleanSentence = removeQuotedContent(sentence)
      items.push({
        sentence: cleanSentence,
        subject,
        currentValue,
        originalSentence: sentence,
      })
    }
  }

  if (items.length === 0) return []

  const changes = await batchExtractEntityChanges(
    provider,
    items.map(i => ({ sentence: i.sentence, subject: i.subject, attribute }))
  )

  const conflicts: Conflict[] = []
  let index = 0
  for (let i = 0; i < items.length; i++) {
    const change = changes[i]
    const item = items[i]!
    if (!change || change.skip) continue

    const newValue = attribute === '所在位置' ? change.location : change.state
    if (!newValue || newValue === item.currentValue) continue

    conflicts.push(
      createConflict(
        item.subject,
        attribute,
        item.currentValue,
        newValue,
        item.originalSentence,
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
  return detectEntityConflicts(
    state.keyItemsLocation,
    outline,
    '所在位置',
    'auto',
    provider,
    isMentionedInSentence
  )
}

export async function detectItemStateConflicts(
  state: StoryState,
  outline: string,
  provider: ModelProvider
): Promise<Conflict[]> {
  return detectEntityConflicts(
    state.keyItemsState,
    outline,
    '状态',
    'auto',
    provider,
    isMentionedInSentence
  )
}

export async function detectCharacterLocationConflicts(
  state: StoryState,
  outline: string,
  provider: ModelProvider
): Promise<Conflict[]> {
  return detectEntityConflicts(
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
  return detectEntityConflicts(
    state.characterStatus,
    outline,
    '状态',
    'warning',
    provider
  )
}

const COMPARISON_STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '你', '他', '她', '它', '这', '那', '一个', '一些', '就', '却', '而', '但',
  '与', '和', '或', '着', '过', '到', '从', '把', '被', '让', '给', '为', '以', '及', '等', '地', '得', '之',
  '也', '很', '更', '最', '非常', '已经', '然后', '因为', '所以', '如果', '虽然', '但是', '不过', '只是',
  '只要', '只有', '能够', '可以', '应该', '需要', '必须', '于', '会', '要', '将', '向', '对',
])

function normalizeForComparison(text: string): string {
  let normalized = text.replace(/[^\u4e00-\u9fff]/g, '')
  for (const word of COMPARISON_STOP_WORDS) {
    normalized = normalized.split(word).join('')
  }
  return normalized
}

export function detectSecretRevealConflicts(state: StoryState, outline: string): Conflict[] {
  const conflicts: Conflict[] = []
  if (!outline || state.revealedSecrets.length === 0) return conflicts

  const normalizedOutline = normalizeForComparison(outline)
  let index = 0
  for (const secret of state.revealedSecrets) {
    const secretSentences = splitSentences(secret)
    let reRevealed = false

    for (const secretSentence of secretSentences) {
      const normalizedSecret = normalizeForComparison(secretSentence)
      if (
        normalizedSecret.length >= 4 &&
        isSemanticallyRelated(normalizedSecret, normalizedOutline, 0.5)
      ) {
        reRevealed = true
        break
      }
    }

    if (!reRevealed) continue

    const hintIndex = outline.indexOf(secret.slice(0, 20))
    const outlineReference =
      hintIndex >= 0
        ? outline.slice(Math.max(0, hintIndex - 30), hintIndex + secret.length + 30)
        : outline.slice(0, 100)

    conflicts.push({
      id: generateConflictId('secret', '已揭示', index++),
      type: 'contradiction',
      subject: '已揭示秘密',
      attribute: '重复揭示',
      oldValue: secret.slice(0, 80),
      newValue: outlineReference.slice(0, 80),
      outlineReference,
      severity: 'blocking',
      description: `大纲试图再次揭示此前已暴露的秘密：「${secret.slice(0, 50)}...」`,
    })
  }

  return conflicts
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

  const [
    itemLocation,
    itemState,
    characterLocation,
    characterStatus,
    secretReveal,
    timeAnchor,
  ] = await Promise.all([
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
  const descriptions = conflicts.map(c => c.description)
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
  const fullNames = characters.map(c => c.name).filter(Boolean).sort((a, b) => b.length - a.length)

  for (const fullName of fullNames) {
    aliasToFull.set(fullName, fullName)

    if (fullName.length >= 3) {
      const lastTwo = fullName.slice(-2)
      if (!aliasToFull.has(lastTwo)) {
        const isAmbiguous = fullNames.some(other => other !== fullName && other.includes(lastTwo))
        if (!isAmbiguous) {
          aliasToFull.set(lastTwo, fullName)
        }
      }
    }

    if (fullName.length >= 4) {
      const lastThree = fullName.slice(-3)
      if (!aliasToFull.has(lastThree)) {
        const isAmbiguous = fullNames.some(other => other !== fullName && other.includes(lastThree))
        if (!isAmbiguous) {
          aliasToFull.set(lastThree, fullName)
        }
      }
    }
  }

  return aliasToFull
}

function reconcileStoryStateContent(
  storyState: StoryState,
  outline: string,
  characters: Array<{ name: string }> = []
): StoryState {
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

  const outlineWords = new Set(
    outline.split(/\s+|，|。|！|？|、|；|\n/).filter(w => w.length >= 2)
  )

  const locMap = new Map<string, string>()
  for (const [char, loc] of Object.entries(storyState.characterLocations)) {
    const normalized = aliasMap.get(char) || char
    locMap.set(normalized, loc)
  }
  reconciled.characterLocations = Object.fromEntries(locMap)

  for (const secret of storyState.revealedSecrets) {
    const secretWords = secret.split(/\s+|，|。|！|？|、|；|\n/).filter(w => w.length >= 2)
    const overlap = secretWords.filter(w => outlineWords.has(w))
    const overlapRatio = secretWords.length > 0 ? overlap.length / secretWords.length : 0

    if (overlapRatio >= 0.3) {
      logger.info(`[MuseFlow] Reconciling: skipping outdated secret with ${Math.round(overlapRatio * 100)}% outline overlap: "${secret.substring(0, 50)}..."`)
      continue
    }

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
    f => f.subject === conflict.subject && f.attribute === conflict.attribute
  )
  const chapterNumber = chapterIndex + 1
  return {
    id: existing?.id ?? generateId('fact'),
    subject: conflict.subject,
    attribute: conflict.attribute,
    value: conflict.newValue,
    establishedIn: chapterNumber,
    source: 'inferred',
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

// 判断从大纲解析出的 retcon 新值是否足够可靠，可写入权威事实。
// 不可靠时降级为 warning，交由 ChapterAgent 在正文中明确处理。
function isReliableRetconValue(conflict: Conflict): boolean {
  const newValue = conflict.newValue.trim()
  const oldValue = conflict.oldValue.trim()

  // 明显截断：新值长度过短，无法承载一个完整地点或状态描述。
  if (newValue.length < Math.max(4, oldValue.length * 0.5)) {
    return false
  }

  return true
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
      if (!isReliableRetconValue(conflict)) {
        remaining.push({ ...conflict, severity: 'warning' })
        continue
      }
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
      if (!isReliableRetconValue(conflict)) {
        remaining.push({ ...conflict, severity: 'warning' })
        continue
      }
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
  const { state: preReconciled, autoResolved, remaining, canonicalFacts, supersededFacts } =
    autoReconcile(classified, storyState, chapterIndex)

  const reconciled = reconcileStoryStateContent(preReconciled, outline, characters)
  reconciled.canonicalFacts = canonicalFacts
  reconciled.supersededFacts = supersededFacts

  const authoritativeState = applyCanonicalFactsToState(reconciled, characters)

  return {
    state: authoritativeState,
    conflicts: remaining,
    autoResolved,
    requiresAuthorDecision: remaining.filter(c => c.severity === 'blocking'),
    suggestedOverrides: generateOverrideSuggestions(remaining, chapterIndex),
  }
}
