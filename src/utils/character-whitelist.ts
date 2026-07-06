import type { Character } from '../types/character.js'

export interface CharacterWhitelist {
  officialNames: Set<string>
  aliases: Map<string, string>
  isOfficial(name: string): boolean
  canonical(name: string): string | undefined
}

/**
 * TODO: This is a heuristic fallback for Chinese names. Once Character supports
 * an explicit aliases field, read from that instead of deriving aliases here.
 */
function deriveAliases(fullName: string): string[] {
  const trimmed = fullName.trim()
  if (trimmed.length < 3) return []
  // For typical Chinese names, the given name is the last 1-2 characters.
  // We include the last two characters as an alias.
  return [trimmed.slice(-2)]
}

export function buildCharacterWhitelist(characters: Character[]): CharacterWhitelist {
  const officialNames = new Set<string>()
  const aliases = new Map<string, string>()

  for (const character of characters) {
    const rawName = character.name.trim()
    if (rawName.length === 0) continue
    officialNames.add(rawName)
    for (const alias of deriveAliases(rawName)) {
      if (alias === rawName) continue
      // Do not overwrite an alias that already maps to a different full name.
      if (!aliases.has(alias)) {
        aliases.set(alias, rawName)
      }
    }
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
