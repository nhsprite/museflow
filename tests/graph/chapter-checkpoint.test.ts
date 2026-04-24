import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rm, readdir, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { getCheckpointer } from '../../src/graph/checkpointer.ts'

const TEST_STORY_ID = 'story_chapter_checkpoint_test'

function createMockCheckpoint(id: string, threadId: string) {
  return {
    id,
    parent_checkpoint_id: null,
    channels: {},
  }
}

function createMockMetadata(threadId: string) {
  return {
    source: 'update' as const,
    step: 1,
    parents: {},
    thread_id: threadId,
  }
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true })
}

describe('chapter-level checkpoints', () => {
  let testOutputDir: string

  beforeEach(async () => {
    testOutputDir = join(process.cwd(), 'books', TEST_STORY_ID)
    await rm(testOutputDir, { force: true, recursive: true }).catch(() => {})
    await ensureDir(join(testOutputDir, 'checkpoints'))
  })

  afterEach(async () => {
    await rm(testOutputDir, { force: true, recursive: true }).catch(() => {})
  })

  describe('saveChapterCheckpoint', () => {
    it('saves chapter checkpoint from latest checkpoint file', async () => {
      const saver = getCheckpointer()
      const checkpointDir = join(testOutputDir, 'checkpoints')
      await writeFile(
        join(checkpointDir, 'checkpoint_1.json'),
        JSON.stringify({
          checkpointId: 'checkpoint_1',
          parentCheckpointId: null,
          checkpoint: createMockCheckpoint('checkpoint_1', TEST_STORY_ID),
          metadata: createMockMetadata(TEST_STORY_ID),
        }),
        'utf-8'
      )

      await saver.saveChapterCheckpoint(testOutputDir, 1)

      const files = await readdir(checkpointDir)
      expect(files).toContain('chapter_1_done.json')
    })

    it('does nothing when checkpoints dir does not exist', async () => {
      const saver = getCheckpointer()
      await rm(join(testOutputDir, 'checkpoints'), { force: true, recursive: true }).catch(() => {})

      await saver.saveChapterCheckpoint(testOutputDir, 1)

      const files = await readdir(join(testOutputDir, 'checkpoints')).catch(() => [])
      expect(files).toEqual([])
    })
  })

  describe('getChapterCheckpoint', () => {
    it('returns checkpoint tuple for existing chapter', async () => {
      const saver = getCheckpointer()
      const checkpointDir = join(testOutputDir, 'checkpoints')

      const mockRecord = {
        checkpointId: 'chapter_1_done',
        parentCheckpointId: null,
        checkpoint: createMockCheckpoint('chapter_1_done', TEST_STORY_ID),
        metadata: createMockMetadata(TEST_STORY_ID),
      }
      await writeFile(
        join(checkpointDir, 'chapter_1_done.json'),
        JSON.stringify(mockRecord),
        'utf-8'
      )

      const result = await saver.getChapterCheckpoint(testOutputDir, 1)

      expect(result).toBeDefined()
      expect(result!.checkpointId).toBe('chapter_1_done')
      expect(result!.checkpoint.id).toBe('chapter_1_done')
    })

    it('returns undefined for non-existing chapter', async () => {
      const saver = getCheckpointer()

      const result = await saver.getChapterCheckpoint(testOutputDir, 99)

      expect(result).toBeUndefined()
    })
  })

  describe('listChapterCheckpoints', () => {
    it('lists all chapter checkpoints sorted by chapter number', async () => {
      const saver = getCheckpointer()
      const checkpointDir = join(testOutputDir, 'checkpoints')

      await writeFile(
        join(checkpointDir, 'chapter_1_done.json'),
        JSON.stringify({
          checkpointId: 'chapter_1_done',
          parentCheckpointId: null,
          checkpoint: createMockCheckpoint('chapter_1_done', TEST_STORY_ID),
          metadata: createMockMetadata(TEST_STORY_ID),
        }),
        'utf-8'
      )
      await writeFile(
        join(checkpointDir, 'chapter_3_done.json'),
        JSON.stringify({
          checkpointId: 'chapter_3_done',
          parentCheckpointId: null,
          checkpoint: createMockCheckpoint('chapter_3_done', TEST_STORY_ID),
          metadata: createMockMetadata(TEST_STORY_ID),
        }),
        'utf-8'
      )
      await writeFile(
        join(checkpointDir, 'chapter_5_done.json'),
        JSON.stringify({
          checkpointId: 'chapter_5_done',
          parentCheckpointId: null,
          checkpoint: createMockCheckpoint('chapter_5_done', TEST_STORY_ID),
          metadata: createMockMetadata(TEST_STORY_ID),
        }),
        'utf-8'
      )

      const result = await saver.listChapterCheckpoints(testOutputDir)

      expect(result).toHaveLength(3)
      expect(result[0].chapterNumber).toBe(1)
      expect(result[1].chapterNumber).toBe(3)
      expect(result[2].chapterNumber).toBe(5)
    })

    it('returns empty array when no checkpoints exist', async () => {
      const saver = getCheckpointer()

      const result = await saver.listChapterCheckpoints(testOutputDir)

      expect(result).toEqual([])
    })
  })

  describe('pruneIntermediateCheckpoints', () => {
    it('deletes intermediate checkpoints keeping chapter-level ones', async () => {
      const saver = getCheckpointer()
      const checkpointDir = join(testOutputDir, 'checkpoints')

      await writeFile(join(checkpointDir, 'checkpoint_1.json'), JSON.stringify({}), 'utf-8')
      await writeFile(join(checkpointDir, 'checkpoint_2.json'), JSON.stringify({}), 'utf-8')
      await writeFile(join(checkpointDir, 'chapter_1_done.json'), JSON.stringify({}), 'utf-8')
      await writeFile(join(checkpointDir, 'chapter_2_done.json'), JSON.stringify({}), 'utf-8')

      await saver.pruneIntermediateCheckpoints(testOutputDir)

      const remaining = await readdir(checkpointDir)
      expect(remaining).toHaveLength(2)
      expect(remaining).toContain('chapter_1_done.json')
      expect(remaining).toContain('chapter_2_done.json')
      expect(remaining).not.toContain('checkpoint_1.json')
      expect(remaining).not.toContain('checkpoint_2.json')
    })

    it('keeps pending_writes.json when pruning', async () => {
      const saver = getCheckpointer()
      const checkpointDir = join(testOutputDir, 'checkpoints')

      await writeFile(join(checkpointDir, 'checkpoint_1.json'), JSON.stringify({}), 'utf-8')
      await writeFile(join(checkpointDir, 'pending_writes.json'), JSON.stringify([]), 'utf-8')

      await saver.pruneIntermediateCheckpoints(testOutputDir)

      const remaining = await readdir(checkpointDir)
      expect(remaining).toContain('pending_writes.json')
      expect(remaining).not.toContain('checkpoint_1.json')
    })
  })
})