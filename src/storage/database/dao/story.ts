import { initDb, getDb, persistDb } from '../index.js'
import type { Story, StoryCreateInput, StoryStatus } from '../../../types/story.js'
import { generateId } from '../../../utils/id.js'
import { getStoryOutputDir } from '../../../utils/paths.js'

export async function initStoryDb(): Promise<void> {
  await initDb()
}

export function createStory(input: StoryCreateInput): Story {
  const db = getDb()
  const now = Date.now()
  const id = generateId('story')
  const outputDir = getStoryOutputDir(id)

  db.run(`
    INSERT INTO story (id, title, idea, genre, total_chapters, status, output_dir, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'init', ?, ?, ?)
  `, [id, '', input.idea, input.genre, input.totalChapters, outputDir, now, now])
  persistDb()

  return {
    id,
    title: '',
    idea: input.idea,
    genre: input.genre,
    totalChapters: input.totalChapters,
    status: 'init',
    provider: input.provider ?? 'openai',
    outputDir,
    createdAt: now,
    updatedAt: now,
  }
}

export function getStory(id: string): Story | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM story WHERE id = ?')
  stmt.bind([id])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as unknown as StoryRow
  stmt.free()
  return rowToStory(row)
}

export function updateStoryStatus(id: string, status: StoryStatus): void {
  const db = getDb()
  db.run('UPDATE story SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id])
  persistDb()
}

export function updateStoryTitle(id: string, title: string): void {
  const db = getDb()
  db.run('UPDATE story SET title = ?, updated_at = ? WHERE id = ?', [title, Date.now(), id])
  persistDb()
}

interface StoryRow {
  id: string
  title: string
  idea: string
  genre: string
  total_chapters: number
  status: string
  provider: string
  output_dir: string
  created_at: number
  updated_at: number
}

function rowToStory(row: StoryRow): Story {
  return {
    id: row.id,
    title: row.title,
    idea: row.idea,
    genre: row.genre,
    totalChapters: row.total_chapters,
    status: row.status as StoryStatus,
    provider: row.provider,
    outputDir: row.output_dir,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
