import type { Character } from '../types/character.js'
import type { SanitizationReport, StoryState } from '../types/story-state.js'
import { buildCharacterWhitelist } from './character-whitelist.js'

const UNIT_WORDS = ['一张', '一封', '一份', '一个', '一本', '一柄', '一把', '一卷', '那块', '那封', '那张', '那件']
const DESCRIPTIVE_SUFFIXES = /[（(][^）)]*[）)]/g

function canonicalizeItemName(name: string): string {
  let normalized = name
    .replace(DESCRIPTIVE_SUFFIXES, '')
    .replace(/^[《〈「『【（\(\[\{\s]+|[》〉」』】）\)\]\}\s]+$/g, '')
    .trim()

  for (const unit of UNIT_WORDS) {
    if (normalized.startsWith(unit)) {
      normalized = normalized.slice(unit.length).trim()
    }
  }

  return normalized.replace(/\s+/g, ' ').trim()
}

function chooseBestItemKey(group: Array<{ item: string; location: string }>): { item: string; location: string } {
  const distinctLocations = Array.from(new Set(group.map(g => g.location)))
  const candidates = distinctLocations.map(loc => {
    const entriesWithLoc = group.filter(g => g.location === loc)
    const lastEntry = entriesWithLoc[entriesWithLoc.length - 1] ?? group[group.length - 1]!
    const mostDescriptive = entriesWithLoc.reduce((a, b) => (a.item.length >= b.item.length ? a : b), lastEntry)
    return { item: mostDescriptive.item, location: loc }
  })

  return candidates[candidates.length - 1] ?? group[group.length - 1]!
}

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
    const canonicalSet = new Set(items.map(canonicalizeItemName))
    if (canonicalSet.size < items.length) {
      ambiguous.push({ location, items })
    }
  }
  return ambiguous
}

export function sanitizeStoryState(
  state: StoryState,
  characters: Character[],
  options?: { preserveExisting?: boolean | undefined; existingStoryState?: StoryState | undefined },
): SanitizationReport {
  const whitelist = buildCharacterWhitelist(characters)

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

  for (const group of itemGroups.values()) {
    const distinctLocations = Array.from(new Set(group.map((g) => g.location)))
    if (distinctLocations.length > 1) {
      const representative = group.reduce((a, b) => (a.item.length >= b.item.length ? a : b), group[0]!)
      itemLocationConflicts.push({
        item: representative.item,
        locations: distinctLocations,
      })
    }

    const best = chooseBestItemKey(group)
    keyItemsLocation[best.item] = best.location
  }

  const ambiguous = detectAmbiguousItemNames({ ...state, keyItemsLocation })
  if (ambiguous.length > 0) {
    console.warn('[MuseFlow] 检测到同一位置下多个歧义物品名：')
    for (const { location, items } of ambiguous) {
      console.warn(`  位置 "${location}" 对应物品：${items.join(' / ')}`)
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

  return {
    state: {
      ...state,
      characterLocations,
      characterStatus,
      keyItemsLocation,
      activePlots,
      revealedSecrets,
    },
    removedCharacters,
    itemLocationConflicts,
    removedFacts,
  }
}
