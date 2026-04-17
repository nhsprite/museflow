import { getDb, persistDb } from '../index.js'
import type { ChapterMeta, ChapterStatus } from '../../../types/chapter.js'
import { generateId } from '../../../utils/id.js'

export function initChapter(storyId: string, number: number, title: string): ChapterMeta {
  const db = getDb()
  const id = generateId('ch')
  const now = Date.now()
  db.run(`
    INSERT OR REPLACE INTO chapter (id, story_id, number, title, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'outline', ?, ?)
  `, [id, storyId, number, title, now, now])
  persistDb()
  return {
    id, storyId, number, title,
    outline: null, summary: null, foreshadows: null,
    status: 'outline', createdAt: now, updatedAt: now,
  }
}

export function updateChapterOutline(storyId: string, number: number, outline: string): void {
  const db = getDb()
  db.run('UPDATE chapter SET outline = ?, updated_at = ? WHERE story_id = ? AND number = ?',
    [outline, Date.now(), storyId, number])
  persistDb()
}

export function updateChapterContent(
  storyId: string,
  number: number,
  summary: string,
  foreshadows: string,
  status: ChapterStatus,
): void {
  const db = getDb()
  db.run(`
    UPDATE chapter SET summary = ?, foreshadows = ?, status = ?, updated_at = ?
    WHERE story_id = ? AND number = ?
  `, [summary, foreshadows, status, Date.now(), storyId, number])
  persistDb()
}

export function getChapter(storyId: string, number: number): ChapterMeta | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM chapter WHERE story_id = ? AND number = ?')
  stmt.bind([storyId, number])
  if (!stmt.step()) { stmt.free(); return null }
  const row = stmt.getAsObject() as unknown as ChapterRow
  stmt.free()
  return rowToChapter(row)
}

export function getChapters(storyId: string): ChapterMeta[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM chapter WHERE story_id = ? ORDER BY number')
  stmt.bind([storyId])
  const results: ChapterMeta[] = []
  while (stmt.step()) {
    results.push(rowToChapter(stmt.getAsObject() as unknown as ChapterRow))
  }
  stmt.free()
  return results
}

export function saveOutline(storyId: string, chapters: { number: number; title: string; description: string }[]): void {
  const db = getDb()
  for (const ch of chapters) {
    db.run(`
      INSERT OR REPLACE INTO outline (id, story_id, chapter_number, title, description)
      VALUES (?, ?, ?, ?, ?)
    `, [generateId('outl'), storyId, ch.number, ch.title, ch.description])
  }
  persistDb()
}

export function getOutline(storyId: string): { number: number; title: string; description: string }[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM outline WHERE story_id = ? ORDER BY chapter_number')
  stmt.bind([storyId])
  const results: { number: number; title: string; description: string }[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as OutlineRow
    results.push({ number: row.chapter_number, title: row.title, description: row.description })
  }
  stmt.free()
  return results
}

interface ChapterRow {
  id: string; story_id: string; number: number; title: string | null;
  outline: string | null; summary: string | null; foreshadows: string | null;
  status: string; created_at: number; updated_at: number;
}

interface OutlineRow {
  id: string; story_id: string; chapter_number: number; title: string; description: string;
}

function rowToChapter(row: ChapterRow): ChapterMeta {
  return {
    id: row.id, storyId: row.story_id, number: row.number, title: row.title,
    outline: row.outline, summary: row.summary, foreshadows: row.foreshadows,
    status: row.status as ChapterStatus, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}
