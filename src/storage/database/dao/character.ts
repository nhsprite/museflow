import type { Character, CharacterCreateInput } from '../../../types/character.js'
import { generateId } from '../../../utils/id.js'
import { readMetaJsonSync, writeMetaJsonSync } from '../index.js'

export function saveCharacter(input: CharacterCreateInput): Character {
  const meta = readMetaJsonSync(input.storyId)
  if (!meta) throw new Error(`Story ${input.storyId} not found`)

  const now = Date.now()
  const character: Character = {
    id: generateId('char'),
    storyId: input.storyId,
    name: input.name,
    description: input.description ?? null,
    dialogueStyle: input.dialogueStyle ?? null,
    createdAt: now,
  }

  meta.characters.push(character)
  writeMetaJsonSync(input.storyId, meta)
  return character
}

export function saveCharacters(storyId: string, characters: Character[]): void {
  const meta = readMetaJsonSync(storyId)
  if (!meta) return
  meta.characters = characters
  writeMetaJsonSync(storyId, meta)
}

export function getCharacters(storyId: string): Character[] {
  const meta = readMetaJsonSync(storyId)
  if (!meta) return []
  return meta.characters
}
