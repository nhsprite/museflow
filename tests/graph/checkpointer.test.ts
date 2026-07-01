import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rm } from 'node:fs/promises'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { validate as validateUuid } from 'uuid'

import { JsonCheckpointer } from '../../src/graph/checkpointer.ts'
import { createCheckpointService } from '../../src/storage/checkpoint-service.ts'
import { emptyCheckpoint } from '@langchain/langgraph-checkpoint'

const TEST_STORY_ID = 'story_checkpointer_test'
let outputDir: string

function makeCheckpoint(id: string, ts: string) {
  const cp = emptyCheckpoint()
  cp.id = id
  cp.ts = ts
  return cp
}

function makeMetadata(step = 0) {
  return { source: 'loop' as const, step, parents: {} }
}

describe('JsonCheckpointer', () => {
  beforeEach(async () => {
    outputDir = mkdtempSync(join(tmpdir(), 'museflow-checkpointer-'))
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

  it('falls back to directory scan when latest.json is missing', async () => {
    const saver = new JsonCheckpointer()
    const cp = makeCheckpoint('cp-1', '2024-01-01T00:00:00.000Z')
    await saver.put({ configurable: { thread_id: TEST_STORY_ID, outputDir } }, cp, makeMetadata(), {})

    const latestPath = join(outputDir, 'checkpoints', 'latest.json')
    await rm(latestPath).catch(() => {})

    const tuple = await saver.getTuple({ configurable: { thread_id: TEST_STORY_ID, outputDir } })
    expect(tuple?.checkpoint.id).toBe('cp-1')
  })

  it('lists checkpoints sorted by timestamp descending', async () => {
    const saver = new JsonCheckpointer()
    const cp1 = makeCheckpoint('cp-1', '2024-01-01T00:00:00.000Z')
    const cp2 = makeCheckpoint('cp-2', '2024-01-01T00:00:01.000Z')
    const cp3 = makeCheckpoint('cp-3', '2024-01-01T00:00:02.000Z')

    await saver.put({ configurable: { thread_id: TEST_STORY_ID, outputDir } }, cp1, makeMetadata(0), {})
    await saver.put({ configurable: { thread_id: TEST_STORY_ID, outputDir } }, cp2, makeMetadata(1), {})
    await saver.put({ configurable: { thread_id: TEST_STORY_ID, outputDir } }, cp3, makeMetadata(2), {})

    const results: string[] = []
    for await (const tuple of saver.list({ configurable: { thread_id: TEST_STORY_ID, outputDir } })) {
      results.push(tuple.checkpoint.id as string)
    }
    expect(results).toEqual(['cp-3', 'cp-2', 'cp-1'])
  })

  it('deleteThread is a no-op', async () => {
    const saver = new JsonCheckpointer()
    await expect(saver.deleteThread(TEST_STORY_ID)).resolves.toBeUndefined()
  })

  it('putWrites is a no-op', async () => {
    const saver = new JsonCheckpointer()
    await expect(saver.putWrites({ configurable: {} }, [], 'task-1')).resolves.toBeUndefined()
  })
})

describe('StoryCheckpointService', () => {
  beforeEach(async () => {
    outputDir = mkdtempSync(join(tmpdir(), 'museflow-checkpointer-'))
  })

  afterEach(async () => {
    await rm(outputDir, { force: true, recursive: true }).catch(() => {})
  })

  it('saves and retrieves chapter markers', async () => {
    const service = createCheckpointService(outputDir)
    await service.saveChapterMarker(1, 'cp-chapter-1')
    await service.saveChapterMarker(3, 'cp-chapter-3')

    expect(await service.getChapterMarker(1)).toBe('cp-chapter-1')
    expect(await service.getChapterMarker(3)).toBe('cp-chapter-3')
    expect(await service.getChapterMarker(2)).toBeUndefined()
  })

  it('lists chapter markers sorted by chapter number', async () => {
    const service = createCheckpointService(outputDir)
    await service.saveChapterMarker(2, 'cp-2')
    await service.saveChapterMarker(1, 'cp-1')
    await service.saveChapterMarker(10, 'cp-10')

    const markers = await service.listChapterMarkers()
    expect(markers.map(m => m.chapterNumber)).toEqual([1, 2, 10])
  })

  it('prunes intermediate checkpoints while keeping markers', async () => {
    const saver = new JsonCheckpointer()
    const cp1 = makeCheckpoint('cp-1', '2024-01-01T00:00:00.000Z')
    const cp2 = makeCheckpoint('cp-2', '2024-01-01T00:00:01.000Z')

    await saver.put({ configurable: { thread_id: TEST_STORY_ID, outputDir } }, cp1, makeMetadata(0), {})
    await saver.put({ configurable: { thread_id: TEST_STORY_ID, outputDir } }, cp2, makeMetadata(1), {})

    const service = createCheckpointService(outputDir)
    await service.saveChapterMarker(1, 'cp-1')
    await service.pruneIntermediateCheckpoints()

    expect(existsSync(join(outputDir, 'checkpoints', 'cp-1.json'))).toBe(true)
    expect(existsSync(join(outputDir, 'checkpoints', 'cp-2.json'))).toBe(false)
  })

  it('updateLatestState writes a valid UUID checkpoint id and updates latest pointer', async () => {
    const saver = new JsonCheckpointer()
    const cp = makeCheckpoint('550e8400-e29b-41d4-a716-446655440000', '2024-01-01T00:00:00.000Z')
    await saver.put({ configurable: { thread_id: TEST_STORY_ID, outputDir } }, cp, makeMetadata(), {})

    const service = createCheckpointService(outputDir)
    await service.updateLatestState({ idea: 'updated' } as unknown as import('../../src/graph/state.js').ReducedGraphState)

    const latestPath = join(outputDir, 'checkpoints', 'latest.json')
    const latest = JSON.parse(readFileSync(latestPath, 'utf-8'))
    expect(validateUuid(latest.checkpointId)).toBe(true)

    const checkpointPath = join(outputDir, 'checkpoints', `${latest.checkpointId}.json`)
    expect(existsSync(checkpointPath)).toBe(true)

    const record = JSON.parse(readFileSync(checkpointPath, 'utf-8'))
    expect(record.checkpointId).toBe(latest.checkpointId)
    expect(record.checkpoint.id).toBe(latest.checkpointId)
    expect(record.checkpoint.channel_values.idea).toBe('updated')

    const tuple = await saver.getTuple({ configurable: { thread_id: TEST_STORY_ID, outputDir } })
    expect(tuple?.checkpoint.id).toBe(latest.checkpointId)
    expect((tuple?.checkpoint.channel_values as Record<string, unknown>).idea).toBe('updated')
  })

  it('uses injected checkpointer instead of global singleton', async () => {
    const baseCheckpoint = makeCheckpoint('parent-id', '2024-01-01T00:00:00.000Z')
    baseCheckpoint.channel_values = { idea: 'original' } as Record<string, unknown>

    const mockCheckpointer = {
      getTuple: vi.fn().mockResolvedValue({
        checkpoint: baseCheckpoint,
        config: { configurable: { thread_id: '', outputDir, checkpoint_id: 'parent-id' } },
        metadata: { source: 'loop', step: 0, parents: {} },
      }),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('../../src/graph/checkpointer.js').JsonCheckpointer

    const service = createCheckpointService(outputDir, mockCheckpointer)
    await service.updateLatestState({ idea: 'injected' } as unknown as import('../../src/graph/state.js').ReducedGraphState)

    expect(mockCheckpointer.getTuple).toHaveBeenCalledWith({
      configurable: { thread_id: '', outputDir },
    })

    expect(mockCheckpointer.put).toHaveBeenCalledTimes(1)
    const [, newCheckpoint] = mockCheckpointer.put.mock.calls[0]!
    expect((newCheckpoint as { channel_values: Record<string, unknown> }).channel_values.idea).toBe('injected')
    expect(validateUuid((newCheckpoint as { id: string }).id)).toBe(true)
  })

  it('clearPendingWrites removes pending_writes.json', async () => {
    const pendingPath = join(outputDir, 'checkpoints', 'pending_writes.json')
    ensureDirForFile(pendingPath)
    writeFileSync(pendingPath, JSON.stringify([]))

    const service = createCheckpointService(outputDir)
    await service.clearPendingWrites()

    expect(existsSync(pendingPath)).toBe(false)
  })
})

function ensureDirForFile(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true })
}
