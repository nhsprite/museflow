import type { Character } from '../types/character.js'

export interface CharacterWhitelist {
  officialNames: Set<string>
  aliases: Map<string, string>
  isOfficial(name: string): boolean
  canonical(name: string): string | undefined
}

export function buildCharacterWhitelist(characters: Character[]): CharacterWhitelist {
  const officialNames = new Set<string>()
  const aliases = new Map<string, string>()

  for (const character of characters) {
    const rawName = character.name.trim()
    if (rawName.length > 0) officialNames.add(rawName)
  }

  return {
    officialNames,
    aliases,
    isOfficial(name: string): boolean {
      const trimmed = name.trim()
      return officialNames.has(trimmed) || aliases.has(trimmed)
    },
    canonical(name: string): string | undefined {
      const trimmed = name.trim()
      if (aliases.has(trimmed)) {
        return aliases.get(trimmed)
      }
      if (officialNames.has(trimmed)) {
        return trimmed
      }
      return undefined
    },
  }
}
