import { getDb, persistDb } from '../index.js'
import type { Character, CharacterCreateInput } from '../../../types/character.js'
import { generateId } from '../../../utils/id.js'

export function saveCharacter(input: CharacterCreateInput): Character {
  const db = getDb()
  const id = generateId('char')
  const now = Date.now()
  db.run(`
    INSERT INTO character_ (id, story_id, name, description, dialogue_style, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [id, input.storyId, input.name, input.description ?? null, input.dialogueStyle ?? null, now])
  persistDb()
  return {
    id,
    storyId: input.storyId,
    name: input.name,
    description: input.description ?? null,
    dialogueStyle: input.dialogueStyle ?? null,
    createdAt: now,
  }
}

export function getCharacters(storyId: string): Character[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM character_ WHERE story_id = ?')
  stmt.bind([storyId])
  const results: Character[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as CharacterRow
    results.push(rowToCharacter(row))
  }
  stmt.free()
  return results
}

interface CharacterRow {
  id: string
  story_id: string
  name: string
  description: string | null
  dialogue_style: string | null
  created_at: number
}

function rowToCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    storyId: row.story_id,
    name: row.name,
    description: row.description,
    dialogueStyle: row.dialogue_style,
    createdAt: row.created_at,
  }
}
