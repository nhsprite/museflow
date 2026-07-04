import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'
import type {
  Checkpoint,
  CheckpointTuple,
  CheckpointMetadata,
  ChannelVersions,
} from '@langchain/langgraph-checkpoint'
import type { RunnableConfig } from '@langchain/core/runnables'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../utils/logger.js'
import { writeFileAtomic, ensureDir } from '../utils/fs.js'

interface CheckpointRecord {
  checkpointId: string
  parentCheckpointId: string | null
  checkpoint: Checkpoint
  metadata: CheckpointMetadata
}

/**
 * JSON-based LangGraph checkpoint saver.
 *
 * 只实现 BaseCheckpointSaver 契约：put / getTuple / list / deleteThread。
 * 所有业务级操作（章节标记、状态更新、清理中间态）已迁移到 StoryCheckpointService。
 */
export class JsonCheckpointer extends BaseCheckpointSaver<string> {
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

  private getCheckpointPath(outputDir: string, checkpointId: string): string {
    return join(this.getCheckpointDir(outputDir), `${checkpointId}.json`)
  }

  private getLatestPointerPath(outputDir: string): string {
    return join(this.getCheckpointDir(outputDir), 'latest.json')
  }

  private readLatestCheckpointId(
    outputDir: string
  ): { checkpointId: string; ts: string } | undefined {
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

  private loadCheckpointRecord(
    outputDir: string,
    checkpointId: string
  ): CheckpointRecord | undefined {
    const path = this.getCheckpointPath(outputDir, checkpointId)
    if (!existsSync(path)) return undefined
    try {
      const raw = readFileSync(path, 'utf-8')
      return JSON.parse(raw) as CheckpointRecord
    } catch {
      return undefined
    }
  }

  private recordToTuple(
    record: CheckpointRecord,
    threadId: string,
    outputDir: string
  ): CheckpointTuple {
    const tuple: CheckpointTuple = {
      config: {
        configurable: { thread_id: threadId, checkpoint_id: record.checkpointId, outputDir },
      },
      checkpoint: record.checkpoint,
      metadata: record.metadata,
    }
    if (record.parentCheckpointId) {
      tuple.parentConfig = {
        configurable: { thread_id: threadId, checkpoint_id: record.parentCheckpointId, outputDir },
      }
    }
    return tuple
  }

  private loadCheckpointRecords(outputDir: string): Map<string, CheckpointRecord> {
    const dir = this.getCheckpointDir(outputDir)
    const records = new Map<string, CheckpointRecord>()
    if (!existsSync(dir)) return records

    for (const file of readdirSync(dir)) {
      if (
        !file.endsWith('.json') ||
        file === 'pending_writes.json' ||
        file === 'chapter_markers.json' ||
        file === 'latest.json'
      )
        continue
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

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined
    const outputDir = config.configurable?.outputDir as string | undefined
    const checkpointId = config.configurable?.checkpoint_id as string | undefined
    if (threadId === undefined || outputDir === undefined) return undefined

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
    options?: { limit?: number; before?: RunnableConfig; filter?: Record<string, unknown> }
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string | undefined
    const outputDir = config.configurable?.outputDir as string | undefined
    if (threadId === undefined || outputDir === undefined) return

    const records = this.loadCheckpointRecords(outputDir)
    const limit = options?.limit ?? 100

    const sorted = [...records.values()].sort((a, b) =>
      b.checkpoint.ts.localeCompare(a.checkpoint.ts)
    )

    let count = 0
    for (const rec of sorted) {
      if (count >= limit) break
      if (options?.before) {
        const beforeId = options.before.configurable?.checkpoint_id as string | undefined
        if (beforeId && rec.checkpointId.localeCompare(beforeId) >= 0) continue
      }
      const tuple: CheckpointTuple = {
        config: {
          configurable: { thread_id: threadId, checkpoint_id: rec.checkpointId, outputDir },
        },
        checkpoint: rec.checkpoint,
        metadata: rec.metadata,
      }
      if (rec.parentCheckpointId) {
        tuple.parentConfig = {
          configurable: { thread_id: threadId, checkpoint_id: rec.parentCheckpointId, outputDir },
        }
      }
      yield tuple
      count++
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string | undefined
    const outputDir = config.configurable?.outputDir as string | undefined
    if (threadId === undefined) throw new Error('thread_id required')
    if (!outputDir) throw new Error('outputDir required in configurable')

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

    return {
      configurable: { thread_id: threadId, checkpoint_id: checkpoint.id as string, outputDir },
    }
  }

  async deleteThread(_threadId: string): Promise<void> {
    // Note: outputDir is no longer cached in memory. Callers should delete the story workspace directly.
    logger.debug(
      'deleteThread is a no-op; use StoryCheckpointService or filesystem deletion instead'
    )
  }

  async putWrites(_config: RunnableConfig, _writes: unknown[], _taskId: string): Promise<void> {
    // Pending writes are managed by LangGraph internally.
    // This method is a no-op to satisfy the BaseCheckpointSaver interface.
  }
}

let _checkpointer: JsonCheckpointer | null = null

export function getCheckpointer(): JsonCheckpointer {
  if (!_checkpointer) {
    _checkpointer = new JsonCheckpointer()
  }
  return _checkpointer
}
