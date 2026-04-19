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
    if (!threadId || !outputDir) return undefined

    const records = this.loadCheckpointRecords(outputDir)
    if (records.size === 0) return undefined

    const sorted = [...records.values()].sort((a, b) =>
      a.checkpointId.localeCompare(b.checkpointId)
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
      .sort((a, b) => b.checkpointId.localeCompare(a.checkpointId))

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

    return { configurable: { thread_id: threadId, checkpoint_id: checkpoint.id as string, outputDir } }
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
}

let _checkpointer: JsonCheckpointer | null = null

export function getCheckpointer(): JsonCheckpointer {
  if (!_checkpointer) {
    _checkpointer = new JsonCheckpointer()
  }
  return _checkpointer
}
