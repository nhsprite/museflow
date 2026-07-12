import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { StoryCheckpointService } from '../../src/storage/checkpoint-service.js'

describe('StoryCheckpointService.deleteChapterMarkersFrom', () => {
  let testDir: string
  let markersPath: string

  beforeEach(() => {
    testDir = join(tmpdir(), `museflow-checkpoint-service-${randomUUID().slice(0, 8)}`)
    const checkpointsDir = join(testDir, 'checkpoints')
    mkdirSync(checkpointsDir, { recursive: true })
    markersPath = join(checkpointsDir, 'chapter_markers.json')
    writeFileSync(
      markersPath,
      JSON.stringify({ 1: 'ckpt-1', 2: 'ckpt-2', 3: 'ckpt-3', 4: 'ckpt-4' }, null, 2)
    )
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  function readMarkers(): Record<string, string> {
    return JSON.parse(readFileSync(markersPath, 'utf-8')) as Record<string, string>
  }

  it('deletes markers after the given chapter and keeps the rest', async () => {
    const service = new StoryCheckpointService(testDir)

    await service.deleteChapterMarkersFrom(2)

    expect(readMarkers()).toEqual({ 1: 'ckpt-1', 2: 'ckpt-2' })
    expect(await service.getChapterMarker(3)).toBeUndefined()
    expect(await service.getChapterMarker(1)).toBe('ckpt-1')
  })

  it('keeps the marker of the chapter being rewritten (it is overwritten on the next commit)', async () => {
    const service = new StoryCheckpointService(testDir)

    await service.deleteChapterMarkersFrom(3)

    expect(await service.listChapterMarkers()).toEqual([
      { chapterNumber: 1, checkpointId: 'ckpt-1' },
      { chapterNumber: 2, checkpointId: 'ckpt-2' },
      { chapterNumber: 3, checkpointId: 'ckpt-3' },
    ])
  })

  it('is a no-op when no markers need deletion', async () => {
    const service = new StoryCheckpointService(testDir)
    const before = readMarkers()

    await service.deleteChapterMarkersFrom(10)

    expect(readMarkers()).toEqual(before)
  })

  it('handles a missing markers file', async () => {
    rmSync(markersPath)
    const service = new StoryCheckpointService(testDir)

    await expect(service.deleteChapterMarkersFrom(1)).resolves.toBeUndefined()
    expect(existsSync(markersPath)).toBe(false)
  })
})
