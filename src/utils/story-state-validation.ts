import { logger } from './logger.js'
import type { Character } from '../types/character.js'
import type { CanonicalFact, SanitizationReport, StoryState, SupersededFact } from '../types/story-state.js'
import { buildCharacterWhitelist } from './character-whitelist.js'
import { canonicalizeItemName, resolveCanonicalItemGroup } from './items.js'

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
        attribute: 'location',
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
