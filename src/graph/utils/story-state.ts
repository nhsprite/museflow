import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type { StoryState, CanonicalFact, PendingTask, ReconciliationReport } from '../../types/story-state.js'
import {
  filterCharacterFactsByImportance,
  filterKeyEventsByImportance,
  getImportanceThreshold,
  getCompressionLevel,
} from '../../utils/summary-compressor.js'
import { createEmptyStoryState } from '../../storage/meta/stores/story-state.js'
import { canonicalizeItemName } from '../../utils/story-state-validation.js'
import { detectAllConflicts } from '../../core/state-reconciliation/conflict-detector.js'
import { classifyConflicts } from '../../core/state-reconciliation/conflict-classifier.js'
import { autoReconcile, applyCanonicalFactsToState, generateOverrideSuggestions } from '../../core/state-reconciliation/auto-reconciler.js'

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

function mergeItemRecord(
  base: Record<string, string>,
  delta: Record<string, string>
): Record<string, string> {
  const merged = { ...base }
  for (const [item, value] of Object.entries(delta)) {
    if (!value || value === '同前') continue
    const canonical = canonicalizeItemName(item)
    // 清除所有同 canonical 的旧条目，确保同一物品最终只有一个位置/状态记录。
    // 这能防止历史状态中的别名或旧位置与新 delta 并存，避免无限重复上报冲突。
    for (const key of Object.keys(merged)) {
      if (canonicalizeItemName(key) === canonical) {
        delete merged[key]
      }
    }
    merged[item] = value
  }

  // 最终扫描：清除 base 中残留的同一规范名多位置。
  // 当 delta 没有提及某个物品，而 base 里已经存在该物品的多个旧位置时，
  // 上面的循环不会处理它们；这里从后往前保留最后一个条目，删除前面的同 canonical 条目。
  const seenCanonical = new Set<string>()
  const keys = Object.keys(merged)
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i]
    if (!key) continue
    const canonical = canonicalizeItemName(key)
    if (seenCanonical.has(canonical)) {
      delete merged[key]
    } else {
      seenCanonical.add(canonical)
    }
  }

  return merged
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

  const mergedItems = mergeItemRecord(base.keyItemsLocation, delta.keyItemsLocation)
  const mergedItemStates = mergeItemRecord(base.keyItemsState, delta.keyItemsState ?? {})

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

export function reconcileStoryState(
  storyState: StoryState,
  outline: string,
  characters: Array<{ name: string }> = [],
  chapterIndex = 0
): ReconciliationReport {
  const rawConflicts = detectAllConflicts(storyState, outline, chapterIndex)
  const classified = classifyConflicts(rawConflicts)
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

  const items = Object.entries(storyState.keyItemsLocation)
  if (items.length > 0) {
    lines.push('【关键物品】')
    for (const [item, loc] of items) {
      lines.push(`  ${item}：${loc}`)
    }
  }

  const itemStates = Object.entries(storyState.keyItemsState ?? {})
  if (itemStates.length > 0) {
    lines.push('【关键物品状态】')
    for (const [item, state] of itemStates) {
      lines.push(`  ${item}：${state}`)
    }
  }

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
