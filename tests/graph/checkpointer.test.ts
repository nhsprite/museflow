import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validate as validateUuid } from 'uuid'

import { JsonCheckpointer } from '../../src/graph/checkpointer.ts'
import { emptyCheckpoint } from '@langchain/langgraph-checkpoint'

const TEST_STORY_ID = 'story_checkpointer_test'

function makeCheckpoint(id: string, ts: string) {
  const cp = emptyCheckpoint()
  cp.id = id
  cp.ts = ts
  return cp
}

function makeMetadata(step = 0) {
  return { source: 'loop' as const, step, parents: {} }
}

describe('checkpointer', () => {
  const outputDir = join(process.cwd(), 'books', TEST_STORY_ID)

  beforeEach(async () => {
    await rm(outputDir, { force: true, recursive: true }).catch(() => {})
  })

  afterEach(async () => {
    await rm(outputDir, { force: true, recursive: true }).catch(() => {})
  })

  it('returns undefined when no checkpoint exists', async () => {
    const saver = new JsonCheckpointer()
    const tuple = await saver.getTuple({ configurable: { thread_id: TEST_STORY_ID, outputDir } })
    expect(tuple).toBeUndefined()
  })

  it('writes a checkpoint and a latest.json pointer', async () => {
    const saver = new JsonCheckpointer()
    const checkpoint = makeCheckpoint('cp-1', '2024-01-01T00:00:00.000Z')
    await saver.put(
      { configurable: { thread_id: TEST_STORY_ID, outputDir } },
      checkpoint,
      makeMetadata(),
      {}
    )

    const checkpointPath = join(outputDir, 'checkpoints', 'cp-1.json')
    expect(existsSync(checkpointPath)).toBe(true)

    const latestPath = join(outputDir, 'checkpoints', 'latest.json')
    expect(existsSync(latestPath)).toBe(true)
    const latest = JSON.parse(readFileSync(latestPath, 'utf-8'))
    expect(latest.checkpointId).toBe('cp-1')
  })

  it('getTuple returns the latest checkpoint via the pointer without scanning', async () => {
    const saver = new JsonCheckpointer()
    const cp1 = makeCheckpoint('cp-1', '2024-01-01T00:00:00.000Z')
    const cp2 = makeCheckpoint('cp-2', '2024-01-01T00:00:01.000Z')

    await saver.put({ configurable: { thread_id: TEST_STORY_ID, outputDir } }, cp1, makeMetadata(0), {})
    await saver.put({ configurable: { thread_id: TEST_STORY_ID, outputDir } }, cp2, makeMetadata(1), {})

    const tuple = await saver.getTuple({ configurable: { thread_id: TEST_STORY_ID, outputDir } })
    expect(tuple).toBeDefined()
    expect(tuple?.checkpoint.id).toBe('cp-2')
    expect(tuple?.config.configurable.checkpoint_id).toBe('cp-2')
    expect(tuple?.config.configurable.outputDir).toBe(outputDir)
  })

  it('getTuple loads a specific checkpoint_id directly', async () => {
    const saver = new JsonCheckpointer()
    const cp1 = makeCheckpoint('cp-1', '2024-01-01T00:00:00.000Z')
    const cp2 = makeCheckpoint('cp-2', '2024-01-01T00:00:01.000Z')

    await saver.put({ configurable: { thread_id: TEST_STORY_ID, outputDir } }, cp1, makeMetadata(0), {})
    await saver.put({ configurable: { thread_id: TEST_STORY_ID, outputDir } }, cp2, makeMetadata(1), {})

    const tuple = await saver.getTuple({
      configurable: { thread_id: TEST_STORY_ID, outputDir, checkpoint_id: 'cp-1' },
    })
    expect(tuple?.checkpoint.id).toBe('cp-1')
  })

  it('saveChapterCheckpoint copies the latest checkpoint and updates the pointer', async () => {
    const saver = new JsonCheckpointer()
    const cp = makeCheckpoint('cp-1', '2024-01-01T00:00:00.000Z')
    await saver.put({ configurable: { thread_id: TEST_STORY_ID, outputDir } }, cp, makeMetadata(), {})

    await saver.saveChapterCheckpoint(outputDir, 3)

    const chapterPath = join(outputDir, 'checkpoints', 'chapter_3_done.json')
    expect(existsSync(chapterPath)).toBe(true)

    const latestPath = join(outputDir, 'checkpoints', 'latest.json')
    const latest = JSON.parse(readFileSync(latestPath, 'utf-8'))
    expect(latest.checkpointId).toBe('chapter_3_done')

    const tuple = await saver.getTuple({ configurable: { thread_id: TEST_STORY_ID, outputDir } })
    expect(tuple?.checkpoint.id).toBe('cp-1')
    expect(tuple?.config.configurable.checkpoint_id).toBe('chapter_3_done')
  })

  it('falls back to directory scan when latest.json is missing', async () => {
    const saver = new JsonCheckpointer()
    const cp = makeCheckpoint('cp-1', '2024-01-01T00:00:00.000Z')
    await saver.put({ configurable: { thread_id: TEST_STORY_ID, outputDir } }, cp, makeMetadata(), {})

    const latestPath = join(outputDir, 'checkpoints', 'latest.json')
    await rm(latestPath).catch(() => {})

    const tuple = await saver.getTuple({ configurable: { thread_id: TEST_STORY_ID, outputDir } })
    expect(tuple?.checkpoint.id).toBe('cp-1')
  })

  it('updateLatestState writes a valid UUID checkpoint id', async () => {
    const saver = new JsonCheckpointer()
    const cp = makeCheckpoint('550e8400-e29b-41d4-a716-446655440000', '2024-01-01T00:00:00.000Z')
    await saver.put({ configurable: { thread_id: TEST_STORY_ID, outputDir } }, cp, makeMetadata(), {})

    await saver.updateLatestState(outputDir, { idea: 'updated' })

    const latestPath = join(outputDir, 'checkpoints', 'latest.json')
    const latest = JSON.parse(readFileSync(latestPath, 'utf-8'))
    expect(validateUuid(latest.checkpointId)).toBe(true)

    const checkpointPath = join(outputDir, 'checkpoints', `${latest.checkpointId}.json`)
    expect(existsSync(checkpointPath)).toBe(true)

    const record = JSON.parse(readFileSync(checkpointPath, 'utf-8'))
    expect(record.checkpointId).toBe(latest.checkpointId)
    expect(record.checkpoint.id).toBe(latest.checkpointId)

    const tuple = await saver.getTuple({ configurable: { thread_id: TEST_STORY_ID, outputDir } })
    expect(tuple?.checkpoint.id).toBe(latest.checkpointId)
    expect((tuple?.checkpoint.channel_values as Record<string, unknown>).idea).toBe('updated')
  })

  it('auto-repairs invalid checkpoint ids when loading', async () => {
    const saver = new JsonCheckpointer()
    const cp = makeCheckpoint('cp-1', '2024-01-01T00:00:00.000Z')
    await saver.put({ configurable: { thread_id: TEST_STORY_ID, outputDir } }, cp, makeMetadata(), {})

    // Simulate a corrupted checkpoint written by an older version of the code.
    const corruptedId = 'ckpt_invalidid123'
    const corruptedRecord = {
      checkpointId: corruptedId,
      parentCheckpointId: null,
      checkpoint: {
        ...cp,
        id: corruptedId,
      },
      metadata: makeMetadata(),
    }
    const corruptedPath = join(outputDir, 'checkpoints', `${corruptedId}.json`)
    writeFileSync(corruptedPath, JSON.stringify(corruptedRecord, null, 2))

    const latestPath = join(outputDir, 'checkpoints', 'latest.json')
    writeFileSync(latestPath, JSON.stringify({ checkpointId: corruptedId, ts: cp.ts }, null, 2))

    const tuple = await saver.getTuple({ configurable: { thread_id: TEST_STORY_ID, outputDir } })
    const repairedId = tuple?.checkpoint.id ?? ''
    expect(validateUuid(repairedId)).toBe(true)
    expect(existsSync(corruptedPath)).toBe(false)
    expect(existsSync(join(outputDir, 'checkpoints', `${repairedId}.json`))).toBe(true)

    const latest = JSON.parse(readFileSync(latestPath, 'utf-8'))
    expect(latest.checkpointId).toBe(repairedId)
  })
})
