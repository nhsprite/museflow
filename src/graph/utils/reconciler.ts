import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type {
  StoryState,
  Conflict,
  ConflictType,
  ConflictSeverity,
  CanonicalFact,
  PendingTask,
  ReconciliationReport,
  StateOverride,
  SupersededFact,
  SanitizationReport,
} from '../../types/story-state.js'
import type { ModelProvider, Message, JsonSchema } from '../../model/provider.js'
import {
  filterCharacterFactsByImportance,
  filterKeyEventsByImportance,
  getImportanceThreshold,
  getCompressionLevel,
} from '../../utils/summary-compressor.js'
import { createEmptyStoryState } from '../../storage/meta/stores/story-state.js'
import { mergeCanonicalRecords, canonicalizeItemName, resolveCanonicalItemGroup } from '../../utils/items.js'
import {
  batchExtractEntityChanges,
  batchDetectTimeJumps,
  batchJudgeBlockingConflictDescriptions,
} from '../../utils/context-judge.js'
import { tokenizeWords } from '../../utils/text.js'
import { buildCharacterWhitelist } from '../../utils/character-whitelist.js'
import { createProvider } from '../../model/registry.js'
import { generateId } from '../../utils/id.js'
import { BlockingConflictError } from '../../utils/errors.js'
import type { Character } from '../../types/character.js'
import { generateOutlineRevisionProposal } from '../../core/chapter-generation/outline-revision-proposal.js'

// ----- Chapter state preparation -----
export interface PreparedStoryState {
  reconciledState: StoryState
  stateConflicts: string
  itemLocationConflicts: Array<{ item: string; locations: string[] }>
}

function buildPendingTasksConstraints(tasks: PendingTask[]): string {
  const pending = tasks.filter(t => t.status === 'pending')
  if (pending.length === 0) return ''

  const lines = [
    '【必须继承的前章任务约束】',
    ...pending.map(t => {
      const due = t.dueTime
        ? `（截止：${t.dueTime}）`
        : t.dueChapter
          ? `（截止章节：第${t.dueChapter}章）`
          : ''
      return `- ${t.assignee}：${t.description}${due}`
    }),
    '',
    '【强制要求】本章规划必须尊重上述任务的执行方式与精确文本。',
    '如果任务要求特定的执行方式或精确文本，本章必须原样遵守，不得改写执行方式或文本。',
    '如果本章只是获知任务结果，必须提供合理的替代信息来源并明确交代，不得让被禁止的直接汇报渠道出现。',
  ]
  return lines.join('\n')
}

function findMatchingKey(record: Record<string, string>, subject: string): string | undefined {
  if (record[subject] !== undefined) return subject
  const canonicalSubject = canonicalizeItemName(subject)
  if (canonicalSubject.length === 0) return undefined
  for (const key of Object.keys(record)) {
    if (canonicalizeItemName(key) === canonicalSubject) return key
  }
  return undefined
}

function findMatchingKeys(record: Record<string, string>, subject: string): string[] {
  const keys: string[] = []
  const canonicalSubject = canonicalizeItemName(subject)
  const hasCanonical = canonicalSubject.length > 0
  for (const key of Object.keys(record)) {
    if (key === subject) {
      keys.push(key)
      continue
    }
    if (hasCanonical && canonicalizeItemName(key) === canonicalSubject) {
      keys.push(key)
    }
  }
  return keys
}

/**
 * 将作者通过 CLI 做出的裁决（source='author' 的 overrides）应用到 storyState。
 *
 * 这是通用机制：它根据 override 的 attribute 更新角色/物品位置或状态，
 * 并同步更新 canonicalFacts，使后续 agent 把作者裁决视为权威事实。
 */
export function applyAuthorOverrides(state: StoryState): StoryState {
  const overrides = state.overrides?.filter(o => o.source === 'author') ?? []
  if (overrides.length === 0) return state

  const result: StoryState = { ...state }
  const canonicalFacts = [...(state.canonicalFacts ?? [])]

  for (const override of overrides) {
    const { subject, attribute, newValue, chapterIndex } = override

    if (attribute === '所在位置') {
      const characterKey = findMatchingKey(result.characterLocations, subject)
      if (characterKey) {
        result.characterLocations[characterKey] = newValue
      }
      for (const itemKey of findMatchingKeys(result.keyItemsLocation, subject)) {
        result.keyItemsLocation[itemKey] = newValue
      }
    } else if (attribute === '状态') {
      const characterKey = findMatchingKey(result.characterStatus, subject)
      if (characterKey) {
        result.characterStatus[characterKey] = newValue
      }
      for (const itemKey of findMatchingKeys(result.keyItemsState, subject)) {
        result.keyItemsState[itemKey] = newValue
      }
    }

    const existingIndex = canonicalFacts.findIndex(
      f => f.subject === subject && f.attribute === attribute
    )
    const fact: CanonicalFact = {
      id: existingIndex >= 0 ? canonicalFacts[existingIndex]!.id : generateId('fact'),
      subject,
      attribute,
      value: newValue,
      establishedIn: chapterIndex + 1,
      supersedes:
        existingIndex >= 0
          ? [
              ...(canonicalFacts[existingIndex]!.supersedes ?? []),
              {
                chapter: canonicalFacts[existingIndex]!.establishedIn,
                oldValue: canonicalFacts[existingIndex]!.value,
              },
            ]
          : [{ chapter: Math.max(1, chapterIndex), oldValue: override.oldValue }],
    }
    if (existingIndex >= 0) {
      canonicalFacts[existingIndex] = fact
    } else {
      canonicalFacts.push(fact)
    }
  }

  result.canonicalFacts = canonicalFacts
  return result
}

function conflictIsDecided(
  conflict: Conflict,
  authorDecisions: Record<string, 'outline' | 'canonical'> | undefined
): boolean {
  if (!authorDecisions) return false
  return authorDecisions[conflict.id] !== undefined
}

export async function prepareStoryStateForChapter(
  state: ReducedGraphState,
  chapterIndex: number
): Promise<PreparedStoryState> {

  const outlineItem = state.outline[chapterIndex]
  let reconciledState: StoryState = state.storyState ?? createEmptyStoryState()
  let stateConflicts = ''
  let itemLocationConflicts: Array<{ item: string; locations: string[] }> = []

  if (outlineItem?.description) {
    reconciledState = applyAuthorOverrides(reconciledState)

    const provider = createProvider()
    const reconciliationReport = await reconcileStoryState(
      reconciledState,
      outlineItem.description,
      state.characters,
      chapterIndex,
      provider
    )
    reconciledState = reconciliationReport.state

    if (reconciliationReport.autoResolved.length > 0) {
      logger.info(`[MuseFlow] 自动协调 ${reconciliationReport.autoResolved.length} 个状态冲突：`)
      for (const conflict of reconciliationReport.autoResolved) {
        logger.info(`  - ${conflict.description}`)
      }
    }

    if (reconciliationReport.requiresAuthorDecision.length > 0) {
      logger.warn('[MuseFlow] 检测到需要作者决策的冲突：')
      for (const conflict of reconciliationReport.requiresAuthorDecision) {
        logger.warn(`  - [${conflict.severity}] ${conflict.description}`)
      }
    }

    const outlineStateCheck = await detectOutlineStateConflicts(
      reconciledState,
      outlineItem.description,
      chapterIndex,
      provider
    )

    const undecidedBlockingConflicts = [
      ...reconciliationReport.requiresAuthorDecision.filter(c => !conflictIsDecided(c, state.authorDecisions)),
      ...outlineStateCheck.conflicts.filter(
        c => c.severity === 'blocking' && !conflictIsDecided(c, state.authorDecisions)
      ),
    ]
    if (undecidedBlockingConflicts.length > 0) {
      const proposal = await generateOutlineRevisionProposal(
        state.outline,
        chapterIndex,
        undecidedBlockingConflicts,
        reconciledState
      )
      throw new BlockingConflictError(undecidedBlockingConflicts, chapterIndex, proposal ?? undefined)
    }

    const sanitizationReport = sanitizeStoryState(reconciledState, state.characters, {
      preserveExisting: true,
      existingStoryState: state.storyState,
      chapterIndex,
    })

    itemLocationConflicts = sanitizationReport.itemLocationConflicts
    if (itemLocationConflicts.length > 0) {
      logger.info(`[MuseFlow] 自动协调 ${itemLocationConflicts.length} 个物品位置冲突：`)
      for (const conflict of itemLocationConflicts) {
        logger.info(`  - ${conflict.item}: ${conflict.locations.join(' / ')}`)
      }
    }

    const conflictNotes = reconciliationReport.conflicts
      .map(c => `[${c.severity}] ${c.description}`)
      .join('\n')
    const outlineConflictNotes = outlineStateCheck.conflicts.length > 0
      ? outlineStateCheck.conflicts.map(c => `[${c.severity}] ${c.description}`).join('\n')
      : ''
    const outlineConstraintNotes = outlineStateCheck.constraints.length > 0
      ? `【大纲-状态约束提醒】\n${outlineStateCheck.constraints.map(c => `- ${c}`).join('\n')}`
      : ''
    const sanitizationNotes = formatStateConflicts(sanitizationReport)
    const pendingTasksNotes = buildPendingTasksConstraints(reconciledState.pendingTasks ?? [])
    stateConflicts = [conflictNotes, outlineConflictNotes, outlineConstraintNotes, sanitizationNotes, pendingTasksNotes].filter(Boolean).join('\n\n')
    reconciledState = sanitizationReport.state
  }

  return {
    reconciledState,
    stateConflicts,
    itemLocationConflicts,
  }
}

// ----- Story state builders & merge -----
function formatCharacterFactEntries(
  entries: Array<{ character: string; facts: string[] }>,
  chapterNum: number
): string {
  if (entries.length === 0) return ''

  const lines = [`第${chapterNum}章角色事实：`]
  for (const entry of entries) {
    lines.push(`  ${entry.character}：`)
    for (const fact of entry.facts) {
      lines.push(`    - ${fact}`)
    }
  }
  return lines.join('\n')
}

function isSupersededFact(text: string, canonicalFacts: CanonicalFact[]): boolean {
  for (const fact of canonicalFacts) {
    if (!fact.supersedes || fact.supersedes.length === 0) continue
    for (const old of fact.supersedes) {
      if (old.oldValue.length === 0) continue
      if (text.includes(fact.subject) && text.includes(old.oldValue)) {
        return true
      }
    }
  }
  return false
}

export function filterSupersededFactsFromTimeline(
  entries: Array<{ character: string; facts: string[] }>,
  canonicalFacts: CanonicalFact[]
): Array<{ character: string; facts: string[] }> {
  if (canonicalFacts.length === 0) return entries
  return entries
    .map(entry => ({
      character: entry.character,
      facts: entry.facts.filter(fact => !isSupersededFact(fact, canonicalFacts)),
    }))
    .filter(entry => entry.facts.length > 0)
}

export function filterSupersededEventsFromTimeline(
  events: string[],
  canonicalFacts: CanonicalFact[]
): string[] {
  if (canonicalFacts.length === 0) return events
  return events.filter(event => !isSupersededFact(event, canonicalFacts))
}

export function buildCharacterFactTimeline(
  state: ReducedGraphState,
  upToChapterIndex: number
): string {
  const summaries = state.chapterSummaries.slice(0, upToChapterIndex)
  if (!summaries.length) return '（暂无历史记录）'

  const canonicalFacts = state.storyState?.canonicalFacts ?? []
  const result: string[] = []

  for (let i = 0; i < summaries.length; i++) {
    const summary = summaries[i]
    if (!summary) continue

    const chapterNum = i + 1
    const level = getCompressionLevel(chapterNum - 1, upToChapterIndex)
    const threshold = getImportanceThreshold(level)

    const filtered = filterCharacterFactsByImportance(summary, threshold)
    const withoutSuperseded = filterSupersededFactsFromTimeline(filtered, canonicalFacts)
    const formatted = formatCharacterFactEntries(withoutSuperseded, chapterNum)

    if (formatted) {
      result.push(formatted)
    }
  }

  return result.length > 0 ? result.join('\n\n') : '（暂无历史记录）'
}

export function buildKeyEventsTimeline(
  state: ReducedGraphState,
  upToChapterIndex: number
): string {
  const summaries = state.chapterSummaries.slice(0, upToChapterIndex)
  if (!summaries.length) return '（暂无历史记录）'

  const canonicalFacts = state.storyState?.canonicalFacts ?? []
  const result: string[] = []

  for (let i = 0; i < summaries.length; i++) {
    const summary = summaries[i]
    if (!summary) continue

    const chapterNum = i + 1
    const level = getCompressionLevel(chapterNum - 1, upToChapterIndex)
    const threshold = getImportanceThreshold(level)

    const events = filterKeyEventsByImportance(summary, threshold)
    const withoutSuperseded = filterSupersededEventsFromTimeline(events, canonicalFacts)
    if (withoutSuperseded.length > 0) {
      result.push(`第${chapterNum}章关键事件：\n${withoutSuperseded.map(e => `  - ${e}`).join('\n')}`)
    }
  }

  return result.length > 0 ? result.join('\n\n') : '（暂无历史记录）'
}


export function mergeStoryState(existing: StoryState | null, delta: StoryState): StoryState {
  const base = existing ?? createEmptyStoryState()

  const mergedLocations = { ...base.characterLocations }
  for (const [char, loc] of Object.entries(delta.characterLocations)) {
    if (loc && loc !== '同前') {
      mergedLocations[char] = loc
    }
  }

  const mergedStatus = { ...base.characterStatus }
  for (const [char, status] of Object.entries(delta.characterStatus)) {
    if (status && status !== '同前') {
      mergedStatus[char] = status
    }
  }

  const mergedItems = mergeCanonicalRecords(base.keyItemsLocation, delta.keyItemsLocation, { ignoreValue: '同前' })
  const mergedItemStates = mergeCanonicalRecords(base.keyItemsState, delta.keyItemsState ?? {}, { ignoreValue: '同前' })

  const mergedPlots = [...base.activePlots]
  for (const plot of delta.activePlots) {
    if (plot && !mergedPlots.includes(plot)) {
      mergedPlots.push(plot)
    }
  }

  const mergedSecrets = [...base.revealedSecrets]
  for (const secret of delta.revealedSecrets) {
    if (secret && !mergedSecrets.includes(secret)) {
      mergedSecrets.push(secret)
    }
  }

  const mergedSuperseded = [...(base.supersededFacts ?? [])]
  for (const fact of delta.supersededFacts ?? []) {
    const isDuplicate = mergedSuperseded.some(
      existing => existing.subject === fact.subject && existing.oldFact === fact.oldFact
    )
    if (!isDuplicate) {
      mergedSuperseded.push(fact)
    }
  }

  const mergedCanonicalFacts = [...(base.canonicalFacts ?? [])]
  for (const fact of delta.canonicalFacts ?? []) {
    const isDuplicate = mergedCanonicalFacts.some(
      existing => existing.subject === fact.subject && existing.attribute === fact.attribute && existing.value === fact.value
    )
    if (!isDuplicate) {
      mergedCanonicalFacts.push(fact)
    }
  }

  const mergedPendingTasks = mergePendingTasks(base.pendingTasks, delta.pendingTasks)

  const result: StoryState = {
    characterLocations: mergedLocations,
    characterStatus: mergedStatus,
    keyItemsLocation: mergedItems,
    keyItemsState: mergedItemStates,
    activePlots: mergedPlots,
    revealedSecrets: mergedSecrets,
    pendingTasks: mergedPendingTasks,
    currentScene: delta.currentScene || base.currentScene,
    storyTime: delta.storyTime || base.storyTime,
  }

  if (mergedSuperseded.length > 0) {
    result.supersededFacts = mergedSuperseded
  }

  if (mergedCanonicalFacts.length > 0) {
    result.canonicalFacts = mergedCanonicalFacts
  }

  const mergedOverrides = [...(base.overrides ?? [])]
  for (const override of delta.overrides ?? []) {
    const isDuplicate = mergedOverrides.some(
      existing => existing.id === override.id
    )
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
    const index = result.findIndex(t => t.id === task.id || (t.assignee === task.assignee && t.description === task.description))
    if (index >= 0) {
      result[index] = { ...result[index], ...task }
    } else {
      result.push(task)
    }
  }
  return result
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

  const authoritativeState = applyCanonicalFactsToState(reconciled)

  return {
    state: authoritativeState,
    conflicts: remaining,
    autoResolved,
    requiresAuthorDecision: remaining.filter(c => c.severity === 'blocking'),
    suggestedOverrides: generateOverrideSuggestions(remaining, chapterIndex),
  }
}

function formatCanonicalItemEntries(
  entries: Record<string, string>,
  sectionTitle: string
): string[] {
  const items = Object.entries(entries)
  if (items.length === 0) return []

  const groups = new Map<
    string,
    { representative: string; aliases: string[]; value: string }
  >()

  for (const [item, value] of items) {
    const canonical = canonicalizeItemName(item)
    const existing = groups.get(canonical)
    if (!existing) {
      groups.set(canonical, { representative: item, aliases: [], value })
      continue
    }

    if (item.length < existing.representative.length) {
      existing.aliases.push(existing.representative)
      existing.representative = item
    } else if (item !== existing.representative) {
      existing.aliases.push(item)
    }
    existing.value = value
  }

  const lines = [sectionTitle]
  for (const { representative, aliases, value } of groups.values()) {
    const aliasNote = aliases.length > 0 ? `（亦称：${aliases.join('、')}）` : ''
    lines.push(`  ${representative}${aliasNote}：${value}`)
  }
  return lines
}

export function formatStoryState(storyState: StoryState): string {
  const lines: string[] = []

  const locations = Object.entries(storyState.characterLocations)
  if (locations.length > 0) {
    lines.push('【角色位置】')
    for (const [char, loc] of locations) {
      lines.push(`  ${char}：${loc}`)
    }
  }

  const statuses = Object.entries(storyState.characterStatus)
  if (statuses.length > 0) {
    lines.push('【角色状态】')
    for (const [char, status] of statuses) {
      lines.push(`  ${char}：${status}`)
    }
  }

  lines.push(...formatCanonicalItemEntries(storyState.keyItemsLocation, '【关键物品】'))
  lines.push(...formatCanonicalItemEntries(storyState.keyItemsState ?? {}, '【关键物品状态】'))

  if (storyState.activePlots.length > 0) {
    lines.push('【进行中的情节】')
    for (const plot of storyState.activePlots) {
      lines.push(`  - ${plot}`)
    }
  }

  if (storyState.revealedSecrets.length > 0) {
    lines.push('【已揭示的秘密】')
    for (const secret of storyState.revealedSecrets) {
      lines.push(`  - ${secret}`)
    }
  }

  if ((storyState.pendingTasks?.length ?? 0) > 0) {
    lines.push('【待办差事】')
    for (const task of storyState.pendingTasks) {
      const due = task.dueTime ?? (task.dueChapter ? `第${task.dueChapter}章前` : '未指定')
      const statusLabel = task.status === 'done' ? '已完成' : task.status === 'postponed' ? '已推迟' : task.status === 'superseded' ? '已覆盖' : task.status === 'expired' ? '已到期' : '待执行'
      lines.push(`  - [${statusLabel}] ${task.assignee}：${task.description}（截止：${due}）`)
    }
  }

  if (storyState.supersededFacts && storyState.supersededFacts.length > 0) {
    lines.push('【已被覆盖的旧事实】')
    for (const fact of storyState.supersededFacts) {
      lines.push(`  - [${fact.subject}] ${fact.oldFact}（原因：${fact.reason}）`)
    }
  }

  if (storyState.canonicalFacts && storyState.canonicalFacts.length > 0) {
    lines.push('【权威事实】')
    for (const fact of storyState.canonicalFacts) {
      lines.push(`  - [${fact.subject}] ${fact.attribute}: ${fact.value} (第${fact.establishedIn + 1}章确立)`)
      for (const old of fact.supersedes ?? []) {
        lines.push(`    覆盖第${old.chapter + 1}章: ${old.oldValue}`)
      }
    }
  }

  if (storyState.currentScene) {
    lines.push(`【当前场景】${storyState.currentScene}`)
  }

  if (storyState.storyTime) {
    lines.push(`【上一章结束时间】${storyState.storyTime}`)
  }

  return lines.length > 0 ? lines.join('\n') : '（暂无状态记录）'
}

// ----- Conflict detection -----
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

export function detectSecretRevealConflicts(state: StoryState, outline: string): Conflict[] {
  const conflicts: Conflict[] = []
  const outlineTokens = tokenizeWords(outline)
  let index = 0

  for (const secret of state.revealedSecrets) {
    const secretSentences = splitSentences(secret)
    let maxOverlapRatio = 0
    for (const secretSentence of secretSentences) {
      const secretTokens = tokenizeWords(secretSentence)
      const overlap = secretTokens.filter(t => outlineTokens.includes(t))
      const overlapRatio = secretTokens.length > 0 ? overlap.length / secretTokens.length : 0
      maxOverlapRatio = Math.max(maxOverlapRatio, overlapRatio)
    }
    if (maxOverlapRatio < 0.3) continue

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

// ----- Conflict classification -----
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

// ----- Auto reconciliation -----
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

// ----- Outline-state conflict detection -----
interface OutlineStateConflictResult {
  conflicts: Array<{
    subject: string
    attribute: string
    oldValue: string
    newValue: string
    severity: ConflictSeverity
    description: string
  }>
  constraints: string[]
}

const DETECTION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          attribute: { type: 'string' },
          oldValue: { type: 'string' },
          newValue: { type: 'string' },
          severity: { type: 'string', enum: ['auto', 'warning', 'blocking'] },
          description: { type: 'string' },
        },
        required: ['subject', 'attribute', 'oldValue', 'newValue', 'severity', 'description'],
      },
    },
    constraints: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['conflicts', 'constraints'],
}

function buildOutlineStateConflictId(subject: string, attribute: string, index: number): string {
  return `outline-state:${subject}:${attribute}:${index}`
}

function formatCanonicalFacts(state: StoryState): string {
  const facts = state.canonicalFacts ?? []
  if (facts.length === 0) return '（暂无权威事实）'

  return facts
    .map(f => {
      const lines = [`- [${f.subject}] ${f.attribute}: ${f.value}（第${f.establishedIn + 1}章确立）`]
      if (f.supersedes && f.supersedes.length > 0) {
        for (const old of f.supersedes) {
          lines.push(`  覆盖第${old.chapter + 1}章旧值: ${old.oldValue}`)
        }
      }
      return lines.join('\n')
    })
    .join('\n')
}

export async function detectOutlineStateConflicts(
  state: StoryState,
  outline: string,
  chapterIndex: number,
  provider?: ModelProvider
): Promise<{ conflicts: Conflict[]; constraints: string[] }> {
  if (!provider || !outline || outline.trim().length === 0) {
    return { conflicts: [], constraints: [] }
  }

  const factsText = formatCanonicalFacts(state)

  const messages: Message[] = [
    {
      role: 'system',
      content: `你是故事状态-大纲对齐检测助手。你的任务是：
1. 检查本章大纲要求是否与已确立的权威事实（canonical facts）存在潜在冲突。
2. 识别权威事实中对本章大纲构成硬约束的事实，并输出为 constraints。

判断规则：
- 如果权威事实明确记录了某个限制、承诺、约定、策略底线，而本章大纲似乎要求违反该限制，则报冲突。
- 如果权威事实只是普通的位置/状态记录，而大纲正常推进了该位置/状态的变化，不要报冲突。
- 如果冲突导致大纲核心动作无法执行（权威事实已使该动作的前提不成立），severity 为 blocking。
- 如果只是需要作者在写作时特别留意、明确交代，severity 为 warning。
- 不要编造权威事实中没有的冲突；不要基于常识推断，只基于提供的 canonical facts。

请输出 JSON，包含 conflicts 数组和 constraints 字符串数组。`,
    },
    {
      role: 'user',
      content: `【第 ${chapterIndex + 1} 章大纲】\n${outline}\n\n【已确立的权威事实】\n${factsText}\n\n请输出 JSON：\n{\n  "conflicts": [...],\n  "constraints": ["约束1", "约束2", ...]\n}`,
    },
  ]

  try {
    let raw: unknown
    if (provider.chatStructured) {
      raw = await provider.chatStructured<OutlineStateConflictResult>(messages, DETECTION_SCHEMA, 0.3)
    } else {
      const text = await provider.chat(messages, 0.3)
      raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim())
    }

    const parsed = raw as OutlineStateConflictResult
    const conflicts: Conflict[] = (parsed.conflicts ?? []).map((c, idx) => ({
      id: buildOutlineStateConflictId(c.subject, c.attribute, idx),
      type: 'contradiction',
      subject: c.subject,
      attribute: c.attribute,
      oldValue: c.oldValue,
      newValue: c.newValue,
      outlineReference: outline.slice(0, 200),
      severity: c.severity,
      description: c.description,
    }))

    const constraints = (parsed.constraints ?? []).filter((c): c is string => typeof c === 'string' && c.length > 0)

    if (conflicts.length > 0) {
      logger.info(`[MuseFlow] 检测到 ${conflicts.length} 个大纲-状态潜在冲突`)
      for (const c of conflicts) {
        logger.info(`  - [${c.severity}] ${c.description}`)
      }
    }

    return { conflicts, constraints }
  } catch (err) {
    logger.warn('[MuseFlow] 大纲-状态冲突检测失败，跳过:', err instanceof Error ? err.message : String(err))
    return { conflicts: [], constraints: [] }
  }
}

// ----- Story state sanitization -----
export function detectAmbiguousItemNames(state: StoryState): Array<{ location: string; items: string[] }> {
  const byLocation = new Map<string, string[]>()
  for (const [item, location] of Object.entries(state.keyItemsLocation)) {
    const list = byLocation.get(location) ?? []
    if (!list.includes(item)) {
      list.push(item)
    }
    byLocation.set(location, list)
  }

  const ambiguous: Array<{ location: string; items: string[] }> = []
  for (const [location, items] of byLocation) {
    if (items.length <= 1) continue
    const canonicalSet = new Set(items.map(item => canonicalizeItemName(item)))
    if (canonicalSet.size < items.length) {
      ambiguous.push({ location, items })
    }
  }
  return ambiguous
}

export function sanitizeStoryState(
  state: StoryState,
  characters: Character[],
  options?: {
    preserveExisting?: boolean | undefined
    existingStoryState?: StoryState | undefined
    chapterIndex?: number | undefined
  },
): SanitizationReport {
  const whitelist = buildCharacterWhitelist(characters)
  const chapterIndex = options?.chapterIndex ?? -1

  const establishedNames = options?.preserveExisting && options?.existingStoryState
    ? new Set([
        ...Object.keys(options.existingStoryState.characterLocations),
        ...Object.keys(options.existingStoryState.characterStatus),
      ])
    : new Set<string>()

  const removedCharactersSet = new Set<string>()

  const characterLocations: Record<string, string> = {}
  for (const [name, location] of Object.entries(state.characterLocations)) {
    if (whitelist.isOfficial(name) || establishedNames.has(name)) {
      characterLocations[name] = location
    } else {
      removedCharactersSet.add(name)
    }
  }

  const characterStatus: Record<string, string> = {}
  for (const [name, status] of Object.entries(state.characterStatus)) {
    if (whitelist.isOfficial(name) || establishedNames.has(name)) {
      characterStatus[name] = status
    } else {
      removedCharactersSet.add(name)
    }
  }

  const removedCharacters = Array.from(removedCharactersSet)

  const itemGroups = new Map<
    string,
    Array<{ item: string; location: string }>
  >()
  for (const [item, location] of Object.entries(state.keyItemsLocation)) {
    const canonical = canonicalizeItemName(item)
    if (canonical.length === 0) continue
    const group = itemGroups.get(canonical) ?? []
    group.push({ item, location })
    itemGroups.set(canonical, group)
  }

  const keyItemsLocation: Record<string, string> = {}
  const itemLocationConflicts: Array<{ item: string; locations: string[] }> = []
  const newSupersededFacts: SupersededFact[] = []
  const newCanonicalFacts: CanonicalFact[] = []

  for (const group of itemGroups.values()) {
    const distinctLocations = Array.from(new Set(group.map((g) => g.location)))
    const hasConflict = distinctLocations.length > 1
    if (hasConflict) {
      const representative = group.reduce((a, b) => (a.item.length >= b.item.length ? a : b), group[0]!)
      itemLocationConflicts.push({
        item: representative.item,
        locations: distinctLocations,
      })
    }

    if (hasConflict) {
      const { winner, superseded } = resolveCanonicalItemGroup(group.map(g => ({ item: g.item, value: g.location })))
      const canonicalSubject = canonicalizeItemName(winner.item)
      const now = Date.now()

      const supersededFacts: SupersededFact[] = superseded.map(s => ({
        subject: canonicalSubject,
        oldFact: s.value,
        reason: `与同一规范名 "${canonicalSubject}" 的权威位置 "${winner.value}" 冲突，已自动归档`,
        chapterIndex,
      }))

      const canonical: CanonicalFact = {
        id: `cf_${chapterIndex}_${canonicalSubject}_${now}`,
        subject: canonicalSubject,
        attribute: '所在位置',
        value: winner.value,
        establishedIn: chapterIndex,
        supersedes: supersededFacts.map(f => ({
          chapter: chapterIndex,
          oldValue: f.oldFact,
        })),
      }

      keyItemsLocation[winner.item] = winner.value
      newSupersededFacts.push(...supersededFacts)
      newCanonicalFacts.push(canonical)
    } else {
      const best = group[group.length - 1] ?? group[0]!
      keyItemsLocation[best.item] = best.location
    }
  }

  const officialNames = Array.from(whitelist.officialNames).concat(
    Array.from(whitelist.aliases.keys()),
  )

  function referencesOfficialCharacter(text: string): boolean {
    return officialNames.some((officialName) => text.includes(officialName))
  }

  const removedFacts: string[] = []

  const activePlots = state.activePlots.filter((plot) => {
    if (!referencesOfficialCharacter(plot)) {
      removedFacts.push(plot)
      return false
    }
    return true
  })

  const revealedSecrets = state.revealedSecrets.filter((secret) => {
    if (!referencesOfficialCharacter(secret)) {
      removedFacts.push(secret)
      return false
    }
    return true
  })

  const ambiguousItems = detectAmbiguousItemNames(state)
  if (ambiguousItems.length > 0) {
    logger.warn('[MuseFlow] 检测到同一位置下多个歧义物品名：')
    for (const { location, items } of ambiguousItems) {
      logger.warn(`  位置 "${location}" 对应物品：${items.join(' / ')}`)
    }
  }

  const mergedSupersededFacts = [...(state.supersededFacts ?? []), ...newSupersededFacts]
  const mergedCanonicalFacts = [...(state.canonicalFacts ?? []), ...newCanonicalFacts]

  return {
    state: {
      ...state,
      characterLocations,
      characterStatus,
      keyItemsLocation,
      activePlots,
      revealedSecrets,
      supersededFacts: mergedSupersededFacts,
      canonicalFacts: mergedCanonicalFacts,
    },
    removedCharacters,
    itemLocationConflicts,
    removedFacts,
    ambiguousItems,
  }
}

export function formatStateConflicts(report: SanitizationReport): string {
  const lines: string[] = []

  if (report.itemLocationConflicts.length > 0) {
    lines.push('【物品位置冲突 - 已自动协调】')
    for (const conflict of report.itemLocationConflicts) {
      lines.push(`  - ${conflict.item}: ${conflict.locations.join(' / ')}`)
    }
    lines.push('  说明：系统已按“后写入优先 + 结论性描述优先”的规则保留唯一位置，旧位置已归档到 supersededFacts。')
  }

  if (report.ambiguousItems.length > 0) {
    lines.push('【歧义物品名 - 必须使用统一名称】')
    for (const { location, items } of report.ambiguousItems) {
      lines.push(`  - 位置 "${location}" 对应：${items.join(' / ')}`)
    }
    lines.push('  要求：以上名称可能指向同一物品，本章统一使用最简洁、最标准的名称，避免同一物品多个别名并存。')
  }

  return lines.join('\n')
}
