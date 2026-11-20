import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrateLegacyCheckpoints } from '../../src/storage/migration.js'

let outputDir: string

beforeEach(() => {
  outputDir = mkdtempSync(join(tmpdir(), 'museflow-migration-'))
  mkdirSync(join(outputDir, 'checkpoints'), { recursive: true })
})

afterEach(() => {
  rmSync(outputDir, { recursive: true, force: true })
})

describe('migrateLegacyCheckpoints', () => {
  it('migrates legacy checkpoint ids and keeps the latest pointer consistent', async () => {
    const checkpointDir = join(outputDir, 'checkpoints')
    const record = {
      checkpointId: 'ckpt_legacy',
      parentCheckpointId: null,
      checkpoint: { id: 'ckpt_legacy', ts: '2024-01-01T00:00:00.000Z' },
      metadata: {},
    }
    writeFileSync(join(checkpointDir, 'ckpt_legacy.json'), JSON.stringify(record))
    writeFileSync(
      join(checkpointDir, 'latest.json'),
      JSON.stringify({ checkpointId: 'ckpt_legacy', ts: record.checkpoint.ts })
    )

    await migrateLegacyCheckpoints(outputDir)

    const latest = JSON.parse(readFileSync(join(checkpointDir, 'latest.json'), 'utf-8')) as {
      checkpointId: string
    }
    const migrated = JSON.parse(
      readFileSync(join(checkpointDir, `${latest.checkpointId}.json`), 'utf-8')
    ) as typeof record
    expect(migrated.checkpointId).toBe(latest.checkpointId)
    expect(migrated.checkpoint.id).toBe(latest.checkpointId)
  })

  it('reports corrupted latest pointers before migrating any files', async () => {
    writeFileSync(join(outputDir, 'checkpoints', 'latest.json'), '{broken')

    await expect(migrateLegacyCheckpoints(outputDir)).rejects.toThrow(
      /Checkpoint 数据损坏.*停止写入/
    )
  })

  it('reports malformed checkpoint records instead of skipping them', async () => {
    writeFileSync(join(outputDir, 'checkpoints', 'broken.json'), '{"checkpointId": "broken"}')

    await expect(migrateLegacyCheckpoints(outputDir)).rejects.toThrow(
      /broken\.json.*缺少有效的 checkpoint\.id/
    )
  })
})
