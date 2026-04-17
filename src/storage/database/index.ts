import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { expandPath } from '../../utils/paths.js'
import { logger } from '../../utils/logger.js'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

let _db: SqlJsDatabase | null = null
let _dbPath: string = ''

export async function initDb(dbPath?: string): Promise<SqlJsDatabase> {
  if (_db) return _db

  const resolved = dbPath ?? expandPath('~/.museflow/museflow.sqlite')
  _dbPath = resolved

  const dir = dirname(resolved)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const SQL = await initSqlJs()

  if (existsSync(resolved)) {
    const buf = readFileSync(resolved)
    _db = new SQL.Database(buf)
    logger.debug(`SQLite loaded from: ${resolved}`)
  } else {
    _db = new SQL.Database()
    logger.debug(`SQLite created (new): ${resolved}`)
  }

  runMigrations()
  return _db
}

export function getDb(): SqlJsDatabase {
  if (!_db) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return _db
}

export function closeDb(): void {
  if (_db) {
    persistDb()
    _db.close()
    _db = null
    logger.debug('SQLite connection closed')
  }
}

export function persistDb(): void {
  if (_db && _dbPath) {
    const data = _db.export()
    const buf = Buffer.from(data)
    writeFileSync(_dbPath, buf)
    logger.debug(`SQLite persisted to: ${_dbPath}`)
  }
}

export function runMigrations(): void {
  const db = getDb()
  db.run(`
    CREATE TABLE IF NOT EXISTS story (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      idea TEXT NOT NULL,
      genre TEXT NOT NULL DEFAULT 'default',
      total_chapters INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'init',
      provider TEXT NOT NULL DEFAULT 'openai',
      output_dir TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      FOREIGN KEY (story_id) REFERENCES story(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS character_ (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      dialogue_style TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (story_id) REFERENCES story(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS outline (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      FOREIGN KEY (story_id) REFERENCES story(id) ON DELETE CASCADE,
      UNIQUE(story_id, chapter_number)
    );

    CREATE TABLE IF NOT EXISTS chapter (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT,
      outline TEXT,
      summary TEXT,
      foreshadows TEXT,
      status TEXT NOT NULL DEFAULT 'outline',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (story_id) REFERENCES story(id) ON DELETE CASCADE,
      UNIQUE(story_id, number)
    );

    CREATE TABLE IF NOT EXISTS context_snapshot (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL UNIQUE,
      state_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (story_id) REFERENCES story(id) ON DELETE CASCADE
    );
  `)
  persistDb()
  logger.debug('Database migrations complete')
}
