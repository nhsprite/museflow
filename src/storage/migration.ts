import { readFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from '../utils/logger.js'
import { writeFileAtomic } from '../utils/fs.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidCheckpointId(id: string): boolean {
  return UUID_PATTERN.test(id)
}

function isLegacyInvalidCheckpointId(id: string): boolean {
  return id.startsWith('ckpt_') && !isValidCheckpointId(id)
}

interface CheckpointRecord {
  checkpointId: string
  parentCheckpointId: string | null
  checkpoint: { id: string; ts: string }
  metadata: unknown
}

/**
 * 一次性迁移老版本 checkpoint。
 *
 * 老版本使用 `ckpt_` 前缀的自定义 ID，LangGraph 的 uuid5 命名空间要求合法 UUID。
 * 本函数扫描 checkpoint 目录，将所有非法 ID 修复为随机 UUID，并更新 latest.json。
 */
export async function migrateLegacyCheckpoints(outputDir: string): Promise<void> {
  const dir = join(outputDir, 'checkpoints')
  if (!existsSync(dir)) return

  const latestPath = join(dir, 'latest.json')
  let latestCheckpointId: string | undefined
  if (existsSync(latestPath)) {
    try {
      const latest = JSON.parse(readFileSync(latestPath, 'utf-8')) as { checkpointId?: string }
      latestCheckpointId = latest.checkpointId
    } catch {
      // ignore corrupted latest pointer
    }
  }

  for (const file of readdirSync(dir)) {
    if (
      !file.endsWith('.json') ||
      file === 'pending_writes.json' ||
      file === 'chapter_markers.json'
    )
      continue
    const path = join(dir, file)
    try {
      const record = JSON.parse(readFileSync(path, 'utf-8')) as CheckpointRecord
      const existingId = record.checkpoint.id
      if (!isLegacyInvalidCheckpointId(existingId)) continue

      const newId = randomUUID()
      logger.warn(`[MuseFlow] 检测到非法 checkpoint ID，自动修复: ${existingId} -> ${newId}`)
      record.checkpointId = newId
      record.checkpoint.id = newId

      const newPath = join(dir, `${newId}.json`)
      writeFileAtomic(newPath, JSON.stringify(record, null, 2))
      unlinkSync(path)

      if (latestCheckpointId === existingId) {
        writeFileAtomic(
          latestPath,
          JSON.stringify({ checkpointId: newId, ts: record.checkpoint.ts }, null, 2)
        )
        latestCheckpointId = newId
      }
    } catch {
      // ignore corrupted checkpoint file
    }
  }
}
