import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rm, readdir, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { getCheckpointer } from '../../src/graph/checkpointer.ts'
import { createCheckpointService } from '../../src/storage/checkpoint-service.ts'
import { emptyCheckpoint } from '@langchain/langgraph-checkpoint'

const TEST_STORY_ID = 'story_chapter_checkpoint_test'

function makeCheckpoint(id: string, ts: string) {
  const cp = emptyCheckpoint()
  cp.id = id
  cp.ts = ts
  return cp
}

function makeMetadata(step = 0) {
  return { source: 'loop' as const, step, parents: {} }
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true })
}

describe('chapter-level checkpoints', () => {
  let testOutputDir: string

  beforeEach(async () => {
    testOutputDir = mkdtempSync(join(tmpdir(), 'museflow-chapter-checkpoint-'))
    await ensureDir(join(testOutputDir, 'checkpoints'))
  })

  afterEach(async () => {
    await rm(testOutputDir, { force: true, recursive: true }).catch(() => {})
  })

  describe('saveChapterMarker', () => {
    it('records the latest checkpoint id for a chapter', async () => {
      const saver = getCheckpointer()
      const cp = makeCheckpoint('checkpoint_1', '2024-01-01T00:00:00.000Z')
      await saver.put(
        { configurable: { thread_id: TEST_STORY_ID, outputDir: testOutputDir } },
        cp,
        makeMetadata(),
        {}
      )

      const service = createCheckpointService(testOutputDir)
      await service.saveChapterMarker(1, 'checkpoint_1')

      const markersPath = join(testOutputDir, 'checkpoints', 'chapter_markers.json')
      expect(existsSync(markersPath)).toBe(true)
      const markers = JSON.parse(readFileSync(markersPath, 'utf-8'))
      expect(markers['1']).toBe('checkpoint_1')
    })

    it('creates markers file when checkpoints dir does not exist', async () => {
      const service = createCheckpointService(testOutputDir)
      await rm(join(testOutputDir, 'checkpoints'), { force: true, recursive: true }).catch(() => {})

      await service.saveChapterMarker(1, 'checkpoint_1')

      const files = await readdir(join(testOutputDir, 'checkpoints'))
      expect(files).toContain('chapter_markers.json')
    })
  })

  describe('getChapterMarker', () => {
    it('returns checkpoint id for existing chapter', async () => {
      const service = createCheckpointService(testOutputDir)
      await service.saveChapterMarker(1, 'chapter_1_done')

      const result = await service.getChapterMarker(1)

      expect(result).toBe('chapter_1_done')
    })

    it('returns undefined for non-existing chapter', async () => {
      const service = createCheckpointService(testOutputDir)
      const result = await service.getChapterMarker(99)
      expect(result).toBeUndefined()
    })
  })

  describe('listChapterMarkers', () => {
    it('lists all chapter markers sorted by chapter number', async () => {
      const service = createCheckpointService(testOutputDir)
      await service.saveChapterMarker(1, 'chapter_1_done')
      await service.saveChapterMarker(3, 'chapter_3_done')
      await service.saveChapterMarker(5, 'chapter_5_done')

      const result = await service.listChapterMarkers()

      expect(result).toHaveLength(3)
      expect(result[0].chapterNumber).toBe(1)
      expect(result[1].chapterNumber).toBe(3)
      expect(result[2].chapterNumber).toBe(5)
    })

    it('returns empty array when no markers exist', async () => {
      const service = createCheckpointService(testOutputDir)
      const result = await service.listChapterMarkers()
      expect(result).toEqual([])
    })
  })

  describe('pruneIntermediateCheckpoints', () => {
    it('deletes intermediate checkpoints keeping marker targets', async () => {
      const service = createCheckpointService(testOutputDir)
      const checkpointDir = join(testOutputDir, 'checkpoints')

      await writeFile(join(checkpointDir, 'checkpoint_1.json'), JSON.stringify({}), 'utf-8')
      await writeFile(join(checkpointDir, 'checkpoint_2.json'), JSON.stringify({}), 'utf-8')
      await writeFile(join(checkpointDir, 'chapter_1_done.json'), JSON.stringify({}), 'utf-8')
      await writeFile(join(checkpointDir, 'chapter_2_done.json'), JSON.stringify({}), 'utf-8')

      await service.saveChapterMarker(1, 'chapter_1_done')
      await service.saveChapterMarker(2, 'chapter_2_done')
      await service.pruneIntermediateCheckpoints()

      const remaining = await readdir(checkpointDir)
      expect(remaining).toContain('chapter_1_done.json')
      expect(remaining).toContain('chapter_2_done.json')
      expect(remaining).toContain('chapter_markers.json')
      expect(remaining).not.toContain('checkpoint_1.json')
      expect(remaining).not.toContain('checkpoint_2.json')
    })

    it('keeps pending_writes.json when pruning', async () => {
      const service = createCheckpointService(testOutputDir)
      const checkpointDir = join(testOutputDir, 'checkpoints')

      await writeFile(join(checkpointDir, 'checkpoint_1.json'), JSON.stringify({}), 'utf-8')
      await writeFile(join(checkpointDir, 'pending_writes.json'), JSON.stringify([]), 'utf-8')
      await writeFile(
        join(checkpointDir, 'latest.json'),
        JSON.stringify({ checkpointId: 'checkpoint_1' }),
        'utf-8'
      )

      await service.pruneIntermediateCheckpoints()

      const remaining = await readdir(checkpointDir)
      expect(remaining).toContain('pending_writes.json')
      expect(remaining).toContain('latest.json')
      expect(remaining).not.toContain('checkpoint_1.json')
    })
  })
})
