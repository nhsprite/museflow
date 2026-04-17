import { getDb, persistDb } from '../index.js'
import type { WorldContent } from '../../../types/context.js'
import { generateId } from '../../../utils/id.js'

export function saveWorld(storyId: string, content: string): WorldContent {
  const db = getDb()
  const id = generateId('world')
  db.run(`INSERT OR REPLACE INTO world (id, story_id, content) VALUES (?, ?, ?)`,
    [id, storyId, content])
  persistDb()
  return { id, storyId, content }
}

export function getWorld(storyId: string): WorldContent | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM world WHERE story_id = ?')
  stmt.bind([storyId])
  if (!stmt.step()) { stmt.free(); return null }
  const row = stmt.getAsObject() as unknown as WorldRow
  stmt.free()
  return { id: row.id, storyId: row.story_id, content: row.content }
}

interface WorldRow {
  id: string
  story_id: string
  content: string
}
