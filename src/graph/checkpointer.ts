import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'
import type { Checkpoint, CheckpointTuple, CheckpointMetadata, PendingWrite, ChannelVersions } from '@langchain/langgraph-checkpoint'
import type { RunnableConfig } from '@langchain/core/runnables'
import { initDb, getDb, persistDb } from '../storage/database/index.js'
import { expandPath } from '../utils/paths.js'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export class SqliteSaver extends BaseCheckpointSaver<number> {
  constructor() {
    const dir = dirname(expandPath('~/.museflow/checkpoints'))
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    initDb(expandPath('~/.museflow/checkpoints/checkpoints.sqlite'))
    super(undefined)
    this.ensureSchema()
  }

  private ensureSchema(): void {
    const db = getDb()
    db.run(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        checkpoint_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_id)
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS pending_writes (
        thread_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        value_json TEXT NOT NULL,
        PRIMARY KEY (thread_id, task_id, channel)
      )
    `)
    persistDb()
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined
    if (!threadId) return undefined
    const db = getDb()
    const stmt = db.prepare(
      'SELECT checkpoint_id, parent_checkpoint_id, checkpoint_json, metadata_json FROM checkpoints WHERE thread_id = ? ORDER BY checkpoint_id DESC LIMIT 1'
    )
    stmt.bind([threadId])
    if (!stmt.step()) { stmt.free(); return undefined }
    const row = stmt.getAsObject() as { checkpoint_id: string; parent_checkpoint_id: string | null; checkpoint_json: string; metadata_json: string }
    stmt.free()
    const tuple: CheckpointTuple = {
      config: { configurable: { thread_id: threadId, checkpoint_id: row.checkpoint_id } },
      checkpoint: JSON.parse(row.checkpoint_json) as Checkpoint,
      metadata: JSON.parse(row.metadata_json) as CheckpointMetadata,
    }
    if (row.parent_checkpoint_id) {
      tuple.parentConfig = { configurable: { thread_id: threadId, checkpoint_id: row.parent_checkpoint_id } }
    }
    return tuple
  }

  async *list(config: RunnableConfig, options?: { limit?: number; before?: RunnableConfig; filter?: Record<string, unknown> }): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string | undefined
    if (!threadId) return
    const db = getDb()
    const limit = options?.limit ?? 100
    const stmt = db.prepare(
      'SELECT checkpoint_id, parent_checkpoint_id, checkpoint_json, metadata_json FROM checkpoints WHERE thread_id = ? ORDER BY checkpoint_id DESC LIMIT ?'
    )
    stmt.bind([threadId, limit])
    while (stmt.step()) {
      const row = stmt.getAsObject() as { checkpoint_id: string; parent_checkpoint_id: string | null; checkpoint_json: string; metadata_json: string }
      const tuple: CheckpointTuple = {
        config: { configurable: { thread_id: threadId, checkpoint_id: row.checkpoint_id } },
        checkpoint: JSON.parse(row.checkpoint_json) as Checkpoint,
        metadata: JSON.parse(row.metadata_json) as CheckpointMetadata,
      }
      if (row.parent_checkpoint_id) {
        tuple.parentConfig = { configurable: { thread_id: threadId, checkpoint_id: row.parent_checkpoint_id } }
      }
      yield tuple
    }
    stmt.free()
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string | undefined
    if (!threadId) throw new Error('thread_id required')
    const db = getDb()
    const parentId = config.configurable?.checkpoint_id as string | undefined ?? null
    db.run(
      'INSERT OR REPLACE INTO checkpoints (thread_id, checkpoint_id, parent_checkpoint_id, checkpoint_json, metadata_json) VALUES (?, ?, ?, ?, ?)',
      [threadId, checkpoint.id, parentId, JSON.stringify(checkpoint), JSON.stringify(metadata)]
    )
    persistDb()
    return { configurable: { thread_id: threadId, checkpoint_id: checkpoint.id } }
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = config.configurable?.thread_id as string | undefined
    if (!threadId) return
    const db = getDb()
    for (const [channel, value] of writes) {
      db.run(
        'INSERT OR REPLACE INTO pending_writes (thread_id, task_id, channel, value_json) VALUES (?, ?, ?, ?)',
        [threadId, taskId, channel, JSON.stringify(value)]
      )
    }
    persistDb()
  }

  async deleteThread(threadId: string): Promise<void> {
    const db = getDb()
    db.run('DELETE FROM checkpoints WHERE thread_id = ?', [threadId])
    db.run('DELETE FROM pending_writes WHERE thread_id = ?', [threadId])
    persistDb()
  }
}

let _checkpointer: SqliteSaver | null = null

export function getCheckpointer(): SqliteSaver {
  if (!_checkpointer) {
    _checkpointer = new SqliteSaver()
  }
  return _checkpointer
}