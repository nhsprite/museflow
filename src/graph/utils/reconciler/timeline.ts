import type { ReducedGraphState } from '../../state.js'
import type { CanonicalFact, FactAttribute } from '../../../types/story-state.js'
import { labelFromFactAttribute } from '../../../types/story-state.js'
import {
  filterCharacterFactsByImportance,
  filterKeyEventsByImportance,
  getImportanceThreshold,
  getCompressionLevel,
} from '../../../utils/summary-compressor.js'

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

export function filterSupersededFactsFromTimeline(
  entries: Array<{ character: string; facts: string[] }>,
  canonicalFacts: CanonicalFact[]
): Array<{ character: string; facts: string[] }> {
  void canonicalFacts
  return entries
}

export function filterSupersededEventsFromTimeline(
  events: string[],
  canonicalFacts: CanonicalFact[]
): string[] {
  void canonicalFacts
  return events
}

function isFactActiveAt(fact: CanonicalFact, upToChapterIndex: number): boolean {
  if (fact.establishedIn < 0 || fact.establishedIn > upToChapterIndex) return false
  if (fact.retiredIn !== undefined && fact.retiredIn <= upToChapterIndex) return false
  return true
}

function groupCanonicalFactsByChapter(
  facts: CanonicalFact[],
  upToChapterIndex: number
): Map<number, CanonicalFact[]> {
  const groups = new Map<number, CanonicalFact[]>()
  for (const fact of facts) {
    if (!isFactActiveAt(fact, upToChapterIndex)) continue
    const list = groups.get(fact.establishedIn) ?? []
    list.push(fact)
    groups.set(fact.establishedIn, list)
  }
  return groups
}

function formatCanonicalFact(fact: CanonicalFact): string {
  const supersedesNote =
    (fact.supersedes ?? []).length > 0
      ? `（覆盖：${fact.supersedes!.map((s) => s.oldValue).join('、')}）`
      : ''
  return `  - [${fact.subject}] ${labelFromFactAttribute(fact.attribute)}: ${fact.value}${supersedesNote}`
}

/**
 * 直接从 canonical facts 构建按章节排列的权威事实时间线。
 * 这是 Agent 应优先使用的历史事实视图，避免从摘要二次提取带来的漂移。
 */
export function buildCanonicalFactTimeline(
  state: ReducedGraphState,
  upToChapterIndex: number
): string {
  const canonicalFacts = state.storyState?.canonicalFacts ?? []
  if (canonicalFacts.length === 0) return '（暂无权威事实记录）'

  const groups = groupCanonicalFactsByChapter(canonicalFacts, upToChapterIndex)
  if (groups.size === 0) return '（暂无权威事实记录）'

  const sortedChapters = Array.from(groups.keys()).sort((a, b) => a - b)
  const result: string[] = []
  for (const chapterIndex of sortedChapters) {
    const facts = groups.get(chapterIndex)
    if (!facts || facts.length === 0) continue
    const chapterNum = chapterIndex + 1
    result.push(`第${chapterNum}章权威事实：\n${facts.map(formatCanonicalFact).join('\n')}`)
  }

  return result.join('\n\n')
}

export function isCharacterSubject(subject: string, characters?: Array<{ name: string }>): boolean {
  if (!characters) return false
  return characters.some((c) => subject === c.name)
}

function isCharacterFact(fact: CanonicalFact, characters: Array<{ name: string }>): boolean {
  const characterAttributes: FactAttribute[] = [
    'location',
    'status',
    'known_info',
    'promise',
    'attitude',
    'dialogue',
    'decision',
    'plan',
  ]
  return (
    isCharacterSubject(fact.subject, characters) && characterAttributes.includes(fact.attribute)
  )
}

function isKeyEventFact(fact: CanonicalFact): boolean {
  const eventAttributes: FactAttribute[] = ['key_event', 'event', 'occurrence', 'result', 'twist']
  return eventAttributes.includes(fact.attribute)
}

export function buildCharacterFactTimeline(
  state: ReducedGraphState,
  upToChapterIndex: number
): string {
  const canonicalFacts = state.storyState?.canonicalFacts ?? []

  // 当存在权威事实时，优先从权威事实构建时间线。
  if (canonicalFacts.length > 0) {
    const groups = groupCanonicalFactsByChapter(canonicalFacts, upToChapterIndex)
    const result: string[] = []
    for (const chapterIndex of Array.from(groups.keys()).sort((a, b) => a - b)) {
      const facts = groups.get(chapterIndex)?.filter((f) => isCharacterFact(f, state.characters))
      if (!facts || facts.length === 0) continue
      const chapterNum = chapterIndex + 1
      result.push(`第${chapterNum}章角色事实：\n${facts.map(formatCanonicalFact).join('\n')}`)
    }
    if (result.length > 0) {
      return result.join('\n\n')
    }
  }

  // 回退：从摘要构建（保留旧行为，用于未启用 canonical facts 的场景）。
  const summaries = state.chapterSummaries.slice(0, upToChapterIndex)
  if (!summaries.length) return '（暂无历史记录）'

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

export function buildKeyEventsTimeline(state: ReducedGraphState, upToChapterIndex: number): string {
  const canonicalFacts = state.storyState?.canonicalFacts ?? []

  // 当存在权威事实时，优先从权威事实构建关键事件时间线。
  if (canonicalFacts.length > 0) {
    const groups = groupCanonicalFactsByChapter(canonicalFacts, upToChapterIndex)
    const result: string[] = []
    for (const chapterIndex of Array.from(groups.keys()).sort((a, b) => a - b)) {
      const facts = groups.get(chapterIndex)?.filter(isKeyEventFact)
      if (!facts || facts.length === 0) continue
      const chapterNum = chapterIndex + 1
      result.push(`第${chapterNum}章关键事件：\n${facts.map(formatCanonicalFact).join('\n')}`)
    }
    if (result.length > 0) {
      return result.join('\n\n')
    }
  }

  // 回退：从摘要构建。
  const summaries = state.chapterSummaries.slice(0, upToChapterIndex)
  if (!summaries.length) return '（暂无历史记录）'

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
      result.push(
        `第${chapterNum}章关键事件：\n${withoutSuperseded.map((e) => `  - ${e}`).join('\n')}`
      )
    }
  }

  return result.length > 0 ? result.join('\n\n') : '（暂无历史记录）'
}
