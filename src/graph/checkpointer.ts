import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'
import type { Checkpoint, CheckpointTuple, CheckpointMetadata, PendingWrite, ChannelVersions } from '@langchain/langgraph-checkpoint'
import type { RunnableConfig } from '@langchain/core/runnables'
import { readFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../utils/logger.js'
import { writeFileAtomic, ensureDir } from '../utils/fs.js'

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

  constructor() {
    super(undefined)
  }

  private getCheckpointDir(outputDir: string): string {
    return join(outputDir, 'checkpoints')
  }

  private ensureCheckpointDir(outputDir: string): string {
    const dir = this.getCheckpointDir(outputDir)
    ensureDir(dir)
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

  private getLatestPointerPath(outputDir: string): string {
    return join(this.getCheckpointDir(outputDir), 'latest.json')
  }

  private readLatestCheckpointId(outputDir: string): { checkpointId: string; ts: string } | undefined {
    const path = this.getLatestPointerPath(outputDir)
    if (!existsSync(path)) return undefined
    try {
      const raw = readFileSync(path, 'utf-8')
      const data = JSON.parse(raw) as { checkpointId?: string; ts?: string }
      if (data.checkpointId) {
        return { checkpointId: data.checkpointId, ts: data.ts ?? '' }
      }
    } catch {
      // ignore corrupted pointer
    }
    return undefined
  }

  private writeLatestCheckpointId(outputDir: string, checkpointId: string, ts: string): void {
    const path = this.getLatestPointerPath(outputDir)
    writeFileAtomic(path, JSON.stringify({ checkpointId, ts }, null, 2))
  }

  private loadCheckpointRecord(outputDir: string, checkpointId: string): CheckpointRecord | undefined {
    const path = this.getCheckpointPath(outputDir, checkpointId)
    if (!existsSync(path)) return undefined
    try {
      const raw = readFileSync(path, 'utf-8')
      return JSON.parse(raw) as CheckpointRecord
    } catch {
      return undefined
    }
  }

  private recordToTuple(record: CheckpointRecord, threadId: string, outputDir: string): CheckpointTuple {
    const tuple: CheckpointTuple = {
      config: { configurable: { thread_id: threadId, checkpoint_id: record.checkpointId, outputDir } },
      checkpoint: record.checkpoint,
      metadata: record.metadata,
    }
    if (record.parentCheckpointId) {
      tuple.parentConfig = { configurable: { thread_id: threadId, checkpoint_id: record.parentCheckpointId, outputDir } }
    }
    return tuple
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
        // ignore corrupted checkpoint file
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
    writeFileAtomic(path, JSON.stringify(writes, null, 2))
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined
    const outputDir = config.configurable?.outputDir as string | undefined
    const checkpointId = config.configurable?.checkpoint_id as string | undefined
    if (!threadId || !outputDir) return undefined

    // If checkpoint_id is provided, look up that specific checkpoint directly
    if (checkpointId) {
      const record = this.loadCheckpointRecord(outputDir, checkpointId)
      if (record) {
        return this.recordToTuple(record, threadId, outputDir)
      }
      // checkpointId provided but not found - fall through to latest
    }

    // Fast path: read the latest pointer file and load the referenced checkpoint directly
    const pointer = this.readLatestCheckpointId(outputDir)
    if (pointer) {
      const record = this.loadCheckpointRecord(outputDir, pointer.checkpointId)
      if (record) {
        return this.recordToTuple(record, threadId, outputDir)
      }
    }

    // Fallback: scan the checkpoint directory (backward compatibility / corrupted pointer)
    const records = this.loadCheckpointRecords(outputDir)
    if (records.size === 0) return undefined

    const sorted = [...records.values()].sort((a, b) =>
      a.checkpoint.ts.localeCompare(b.checkpoint.ts)
    )
    const latest = sorted[sorted.length - 1]
    if (!latest) return undefined

    return this.recordToTuple(latest, threadId, outputDir)
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
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string | undefined
    const outputDir = config.configurable?.outputDir as string | undefined
    if (!threadId) throw new Error('thread_id required')
    if (!outputDir) throw new Error('outputDir required in configurable')

    this.threadIdToOutputDir.set(threadId, outputDir)

    const dir = this.ensureCheckpointDir(outputDir)
    const parentId = (config.configurable?.checkpoint_id as string | undefined) ?? null

    const record: CheckpointRecord = {
      checkpointId: checkpoint.id as string,
      parentCheckpointId: parentId,
      checkpoint,
      metadata,
    }

    const path = join(dir, `${checkpoint.id}.json`)
    writeFileAtomic(path, JSON.stringify(record, null, 2))
    this.writeLatestCheckpointId(outputDir, checkpoint.id as string, checkpoint.ts)
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

    const pointer = this.readLatestCheckpointId(outputDir)
    if (!pointer) return

    const record = this.loadCheckpointRecord(outputDir, pointer.checkpointId)
    if (!record) return

    const chapterCheckpointId = `chapter_${chapterNumber}_done`
    record.checkpointId = chapterCheckpointId
    record.parentCheckpointId = record.parentCheckpointId ?? null

    const targetPath = join(dir, `${chapterCheckpointId}.json`)
    writeFileAtomic(targetPath, JSON.stringify(record, null, 2))
    this.writeLatestCheckpointId(outputDir, chapterCheckpointId, record.checkpoint.ts)
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
