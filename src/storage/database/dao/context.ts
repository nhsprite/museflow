import { getDb, persistDb } from '../index.js'
import type { ContextSnapshot } from '../../../types/context.js'
import { generateId } from '../../../utils/id.js'

export function saveContextSnapshot(storyId: string, stateJson: string): ContextSnapshot {
  const db = getDb()
  const id = generateId('snap')
  const now = Date.now()
  db.run(`
    INSERT OR REPLACE INTO context_snapshot (id, story_id, state_json, created_at)
    VALUES (?, ?, ?, ?)
  `, [id, storyId, stateJson, now])
  persistDb()
  return { id, storyId, stateJson, createdAt: now }
}

export function getContextSnapshot(storyId: string): ContextSnapshot | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM context_snapshot WHERE story_id = ?')
  stmt.bind([storyId])
  if (!stmt.step()) { stmt.free(); return null }
  const row = stmt.getAsObject() as unknown as SnapshotRow
  stmt.free()
  return { id: row.id, storyId: row.story_id, stateJson: row.state_json, createdAt: row.created_at }
}

interface SnapshotRow {
  id: string; story_id: string; state_json: string; created_at: number;
}
