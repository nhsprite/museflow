import type { Character } from '../types/character.js'
import type { SanitizationReport, StoryState } from '../types/story-state.js'
import { buildCharacterWhitelist } from './character-whitelist.js'

function canonicalizeItemName(name: string): string {
  return name.replace(/^[《〈「『【（\(\[\{]+|[》〉」』】）\)\]\}]+$/g, '').trim()
}

export function sanitizeStoryState(
  state: StoryState,
  characters: Character[],
  options?: { preserveExisting?: boolean },
): SanitizationReport {
  const whitelist = buildCharacterWhitelist(characters)

  const establishedNames = options?.preserveExisting
    ? new Set([
        ...Object.keys(state.characterLocations),
        ...Object.keys(state.characterStatus),
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
    const group = itemGroups.get(canonical) ?? []
    group.push({ item, location })
    itemGroups.set(canonical, group)
  }

  const keyItemsLocation: Record<string, string> = {}
  const itemLocationConflicts: Array<{ item: string; locations: string[] }> = []

  for (const group of itemGroups.values()) {
    const distinctLocations = Array.from(new Set(group.map((g) => g.location)))
    const shortest = group.reduce((a, b) => (a.item.length <= b.item.length ? a : b))

    if (distinctLocations.length > 1) {
      itemLocationConflicts.push({
        item: shortest.item,
        locations: distinctLocations,
      })
    }

    keyItemsLocation[shortest.item] = shortest.location
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
