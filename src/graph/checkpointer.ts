import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'
import type { Checkpoint, CheckpointTuple, CheckpointMetadata, PendingWrite, ChannelVersions } from '@langchain/langgraph-checkpoint'
import type { RunnableConfig } from '@langchain/core/runnables'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../utils/logger.js'

interface CheckpointRecord {
  checkpointId: string
  parentCheckpointId: string | null
  checkpoint: Checkpoint
  metadata: CheckpointMetadata
}

interface PendingWritesRecord {
  taskId: string
  channel: string
  value: unknown
}

export class JsonCheckpointer extends BaseCheckpointSaver<string> {
  private threadIdToOutputDir: Map<string, string> = new Map()
  // Track the last checkpoint ID created, used by saveChapterCheckpoint to find the correct checkpoint
  private lastCreatedCheckpointId: string | null = null

  constructor() {
    super(undefined)
  }

  private getCheckpointDir(outputDir: string): string {
    return join(outputDir, 'checkpoints')
  }

  private ensureCheckpointDir(outputDir: string): string {
    const dir = this.getCheckpointDir(outputDir)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  private getOutputDir(threadId: string): string | undefined {
    return this.threadIdToOutputDir.get(threadId)
  }

  private getCheckpointPath(outputDir: string, checkpointId: string): string {
    return join(this.getCheckpointDir(outputDir), `${checkpointId}.json`)
  }

  private getPendingWritesPath(outputDir: string): string {
    return join(this.getCheckpointDir(outputDir), 'pending_writes.json')
  }

  private loadCheckpointRecords(outputDir: string): Map<string, CheckpointRecord> {
    const dir = this.getCheckpointDir(outputDir)
    const records = new Map<string, CheckpointRecord>()
    if (!existsSync(dir)) return records

    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json') || file === 'pending_writes.json') continue
      try {
        const raw = readFileSync(join(dir, file), 'utf-8')
        const rec = JSON.parse(raw) as CheckpointRecord
        records.set(rec.checkpointId, rec)
      } catch {
      }
    }
    return records
  }

  private loadPendingWrites(outputDir: string): PendingWritesRecord[] {
    const path = this.getPendingWritesPath(outputDir)
    if (!existsSync(path)) return []
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as PendingWritesRecord[]
    } catch {
      return []
    }
  }

  private savePendingWrites(outputDir: string, writes: PendingWritesRecord[]): void {
    const dir = this.ensureCheckpointDir(outputDir)
    const path = join(dir, 'pending_writes.json')
    writeFileSync(path, JSON.stringify(writes, null, 2), 'utf-8')
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined
    const outputDir = config.configurable?.outputDir as string | undefined
    const checkpointId = config.configurable?.checkpoint_id as string | undefined
    if (!threadId || !outputDir) return undefined

    const records = this.loadCheckpointRecords(outputDir)
    if (records.size === 0) return undefined

    // If checkpoint_id is provided, look up that specific checkpoint
    if (checkpointId) {
      const record = records.get(checkpointId)
      if (record) {
        const tuple: CheckpointTuple = {
          config: { configurable: { thread_id: threadId, checkpoint_id: record.checkpointId, outputDir } },
          checkpoint: record.checkpoint,
          metadata: record.metadata,
        }
        if (record.parentCheckpointId) {
          tuple.parentConfig = { configurable: { thread_id: threadId, checkpoint_id: record.parentCheckpointId } }
        }
        return tuple
      }
      // checkpointId provided but not found - fall through to latest
    }

    // No checkpoint_id or not found - return latest checkpoint
    const sorted = [...records.values()].sort((a, b) =>
      a.checkpoint.ts.localeCompare(b.checkpoint.ts)
    )
    const latest = sorted[sorted.length - 1]
    if (!latest) return undefined

    const tuple: CheckpointTuple = {
      config: { configurable: { thread_id: threadId, checkpoint_id: latest.checkpointId } },
      checkpoint: latest.checkpoint,
      metadata: latest.metadata,
    }
    if (latest.parentCheckpointId) {
      tuple.parentConfig = { configurable: { thread_id: threadId, checkpoint_id: latest.parentCheckpointId } }
    }
    return tuple
  }

  async *list(
    config: RunnableConfig,
    options?: { limit?: number; before?: RunnableConfig; filter?: Record<string, unknown> },
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string | undefined
    const outputDir = config.configurable?.outputDir as string | undefined
    if (!threadId || !outputDir) return

    const records = this.loadCheckpointRecords(outputDir)
    const limit = options?.limit ?? 100

    const sorted = [...records.values()]
      .sort((a, b) => b.checkpoint.ts.localeCompare(a.checkpoint.ts))

    let count = 0
    for (const rec of sorted) {
      if (count >= limit) break
      if (options?.before) {
        const beforeId = options.before.configurable?.checkpoint_id as string | undefined
        if (beforeId && rec.checkpointId.localeCompare(beforeId) >= 0) continue
      }
      const tuple: CheckpointTuple = {
        config: { configurable: { thread_id: threadId, checkpoint_id: rec.checkpointId, outputDir } },
        checkpoint: rec.checkpoint,
        metadata: rec.metadata,
      }
      if (rec.parentCheckpointId) {
        tuple.parentConfig = { configurable: { thread_id: threadId, checkpoint_id: rec.parentCheckpointId, outputDir } }
      }
      yield tuple
      count++
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string | undefined
    const outputDir = config.configurable?.outputDir as string | undefined
    if (!threadId) throw new Error('thread_id required')
    if (!outputDir) throw new Error('outputDir required in configurable')

    this.threadIdToOutputDir.set(threadId, outputDir)
    this.lastCreatedCheckpointId = checkpoint.id as string

    const dir = this.ensureCheckpointDir(outputDir)
    const parentId = (config.configurable?.checkpoint_id as string | undefined) ?? null

    const record: CheckpointRecord = {
      checkpointId: checkpoint.id as string,
      parentCheckpointId: parentId,
      checkpoint,
      metadata,
    }

    const path = join(dir, `${checkpoint.id}.json`)
    writeFileSync(path, JSON.stringify(record, null, 2), 'utf-8')
    logger.debug(`Checkpoint saved: ${outputDir}/${checkpoint.id}`)

    this.savePendingWrites(outputDir, [])

    return { configurable: { thread_id: threadId, checkpoint_id: checkpoint.id as string, outputDir } }
  }

  async deleteThread(threadId: string): Promise<void> {
    const outputDir = this.getOutputDir(threadId)
    if (!outputDir) return

    const dir = this.getCheckpointDir(outputDir)
    if (!existsSync(dir)) return

    for (const file of readdirSync(dir)) {
      if (file.endsWith('.json')) {
        unlinkSync(join(dir, file))
      }
    }
    logger.debug(`Deleted checkpoints for thread: ${threadId}`)
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = config.configurable?.thread_id as string | undefined
    const outputDir = config.configurable?.outputDir as string | undefined
    if (!threadId || !outputDir) return

    const existing = this.loadPendingWrites(outputDir)
    const filtered = existing.filter(w => !(w.taskId === taskId))
    const newWrites: PendingWritesRecord[] = writes.map(([channel, value]) => ({ taskId, channel, value }))
    this.savePendingWrites(outputDir, [...filtered, ...newWrites])
  }

  async loadPendingWritesForThread(outputDir: string): Promise<PendingWritesRecord[]> {
    return this.loadPendingWrites(outputDir)
  }

  async saveChapterCheckpoint(outputDir: string, chapterNumber: number): Promise<void> {
    const dir = this.getCheckpointDir(outputDir)
    if (!existsSync(dir)) return

    const chapterCheckpointId = `chapter_${chapterNumber}_done`

    let sourcePath: string
    if (this.lastCreatedCheckpointId) {
      sourcePath = join(dir, `${this.lastCreatedCheckpointId}.json`)
      if (!existsSync(sourcePath)) {
        return
      }
    } else {
      const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'pending_writes.json' && !f.startsWith('chapter_'))
      if (files.length === 0) return
      const sorted = files.sort((a, b) => b.localeCompare(a))
      sourcePath = join(dir, sorted[0]!)
    }

    const targetPath = join(dir, `${chapterCheckpointId}.json`)

    const raw = readFileSync(sourcePath, 'utf-8')
    const record = JSON.parse(raw) as CheckpointRecord
    record.checkpointId = chapterCheckpointId
    record.parentCheckpointId = record.parentCheckpointId ?? null

    writeFileSync(targetPath, JSON.stringify(record, null, 2), 'utf-8')
    this.lastCreatedCheckpointId = null
    logger.debug(`Chapter-level checkpoint saved: ${targetPath}`)
  }

  async getChapterCheckpoint(outputDir: string, chapterNumber: number): Promise<{ checkpointId: string; checkpoint: Checkpoint; metadata: CheckpointMetadata } | undefined> {
    const chapterCheckpointId = `chapter_${chapterNumber}_done`
    const path = join(this.getCheckpointDir(outputDir), `${chapterCheckpointId}.json`)

    if (!existsSync(path)) {
      return undefined
    }

    try {
      const raw = readFileSync(path, 'utf-8')
      const record = JSON.parse(raw) as CheckpointRecord
      return {
        checkpointId: chapterCheckpointId,
        checkpoint: record.checkpoint,
        metadata: record.metadata,
      }
    } catch {
      return undefined
    }
  }

  /**
   * List all chapter-level checkpoints for a story.
   */
  async listChapterCheckpoints(outputDir: string): Promise<{ chapterNumber: number; checkpointId: string }[]> {
    const dir = this.getCheckpointDir(outputDir)
    if (!existsSync(dir)) return []

    const results: { chapterNumber: number; checkpointId: string }[] = []
    const prefix = 'chapter_'
    const suffix = '_done.json'

    for (const file of readdirSync(dir)) {
      if (!file.startsWith(prefix) || !file.endsWith(suffix)) continue
      const chapterNum = parseInt(file.slice(prefix.length, file.length - suffix.length), 10)
      if (!isNaN(chapterNum)) {
        results.push({ chapterNumber: chapterNum, checkpointId: file.slice(0, -5) })
      }
    }

return results.sort((a, b) => a.chapterNumber - b.chapterNumber)
  }

  async pruneIntermediateCheckpoints(outputDir: string): Promise<void> {
    const dir = this.getCheckpointDir(outputDir)
    if (!existsSync(dir)) return

    const chapterPrefix = 'chapter_'
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.json') && f !== 'pending_writes.json')

    const chapterCheckpoints = new Set(files.filter(f => f.startsWith(chapterPrefix)))
    const toDelete = files.filter(f => !f.startsWith(chapterPrefix) && !chapterCheckpoints.has(f))

    for (const file of toDelete) {
      unlinkSync(join(dir, file))
      logger.debug(`Pruned intermediate checkpoint: ${file}`)
    }

    logger.debug(`Pruned ${toDelete.length} intermediate checkpoints, kept ${chapterCheckpoints.size} chapter checkpoints`)
  }

  async clearPendingWrites(outputDir: string): Promise<void> {
    const path = this.getPendingWritesPath(outputDir)
    if (existsSync(path)) {
      unlinkSync(path)
      logger.debug(`Cleared pending writes: ${path}`)
    }
  }
}

let _checkpointer: JsonCheckpointer | null = null

export function getCheckpointer(): JsonCheckpointer {
  if (!_checkpointer) {
    _checkpointer = new JsonCheckpointer()
  }
  return _checkpointer
}
