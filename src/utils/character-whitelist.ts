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
  const officialClaims = new Map<string, Set<string>>()
  const aliasClaims = new Map<string, Set<string>>()

  for (const character of characters) {
    const rawName = character.name.trim()
    const rawId = character.id.trim()
    if (rawId.length === 0 || rawName.length === 0) continue
    officialNames.add(rawName)
    for (const reference of [rawId, rawName]) {
      const claims = officialClaims.get(reference) ?? new Set<string>()
      claims.add(rawId)
      officialClaims.set(reference, claims)
    }
    for (const declaredAlias of character.aliases) {
      const alias = declaredAlias.trim()
      if (alias.length === 0) continue
      const claims = aliasClaims.get(alias) ?? new Set<string>()
      claims.add(rawId)
      aliasClaims.set(alias, claims)
    }
  }

  for (const [reference, claims] of officialClaims) {
    if (claims.size === 1) {
      idByReference.set(reference, claims.values().next().value!)
    }
  }

  for (const [alias, claims] of aliasClaims) {
    if (officialClaims.has(alias) || claims.size !== 1) continue
    const characterId = claims.values().next().value!
    aliases.set(alias, characterId)
    idByReference.set(alias, characterId)
  }

  for (const reference of officialClaims.keys()) {
    if ((officialClaims.get(reference)?.size ?? 0) !== 1) {
      officialNames.delete(reference)
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
