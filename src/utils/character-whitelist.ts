import type { Character } from '../types/character.js'

export interface CharacterWhitelist {
  officialNames: Set<string>
  aliases: Map<string, string>
  isOfficial(reference: string): boolean
  canonical(reference: string): string | undefined
}

export function buildCharacterWhitelist(characters: Character[]): CharacterWhitelist {
  const officialNames = new Set<string>()
  const aliases = new Map<string, string>()
  const idByReference = new Map<string, string>()

  for (const character of characters) {
    const rawName = character.name.trim()
    const rawId = character.id.trim()
    if (rawId.length === 0 || rawName.length === 0) continue
    officialNames.add(rawName)
    if (!idByReference.has(rawId)) idByReference.set(rawId, rawId)
    if (!idByReference.has(rawName)) idByReference.set(rawName, rawId)
    for (const declaredAlias of character.aliases) {
      const alias = declaredAlias.trim()
      if (alias.length === 0 || idByReference.has(alias)) continue
      aliases.set(alias, rawId)
      idByReference.set(alias, rawId)
    }
  }

  return {
    officialNames,
    aliases,
    isOfficial(reference: string): boolean {
      return idByReference.has(reference.trim())
    },
    canonical(reference: string): string | undefined {
      return idByReference.get(reference.trim())
    },
  }
}
