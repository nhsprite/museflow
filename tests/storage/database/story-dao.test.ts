import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { initDb, closeDb } from '../../../src/storage/database/index.ts'
import { createStory, getStory, updateStoryStatus, updateStoryTitle } from '../../../src/storage/database/dao/story.ts'

const TEST_DB = '/tmp/museflow_test_smoke.sqlite'

describe('story DAO', () => {
  beforeEach(async () => {
    await rm(TEST_DB, { force: true }).catch(() => {})
    await initDb(TEST_DB)
  })

  afterEach(() => {
    closeDb()
  })

  it('should create and retrieve a story', async () => {
    const story = createStory({
      title: 'Hello 世界!!! / test',
      idea: 'test idea',
      genre: 'fantasy',
      totalChapters: 10,
    })
    expect(story.id).toBeDefined()
    expect(story.title).toBe('Hello 世界!!! / test')
    expect(story.idea).toBe('test idea')
    expect(story.genre).toBe('fantasy')
    expect(story.totalChapters).toBe(10)
    expect(story.status).toBe('init')
    expect(story.outputDir).toBe(join(process.cwd(), 'books', `${story.title ? 'hello-世界-test' : 'untitled'}-${story.id.split('_').pop()?.slice(0, 6)}`))

    const loaded = getStory(story.id)
    expect(loaded).not.toBeNull()
    expect(loaded?.title).toBe('Hello 世界!!! / test')
    expect(loaded?.idea).toBe('test idea')
    expect(loaded?.outputDir).toBe(story.outputDir)
  })

  it('should fall back to untitled output dirs for missing or invalid titles', async () => {
    const untitled = createStory({ idea: 'test', genre: 'fantasy', totalChapters: 3 })
    expect(untitled.outputDir).toBe(
      join(process.cwd(), 'books', `untitled-${untitled.id.split('_').pop()?.slice(0, 6)}`),
    )

    const invalid = createStory({
      title: '!!!///***',
      idea: 'test',
      genre: 'fantasy',
      totalChapters: 3,
    })
    expect(invalid.outputDir).toBe(
      join(process.cwd(), 'books', `untitled-${invalid.id.split('_').pop()?.slice(0, 6)}`),
    )
  })

  it('should update story status', async () => {
    const story = createStory({ idea: 'test', genre: 'scifi', totalChapters: 5 })
    updateStoryStatus(story.id, 'worldbuilding')
    const loaded = getStory(story.id)
    expect(loaded?.status).toBe('worldbuilding')
  })

  it('should update story title', async () => {
    const story = createStory({ idea: 'test', genre: 'xianxia', totalChapters: 20 })
    const originalOutputDir = story.outputDir
    updateStoryTitle(story.id, 'My Novel Title')
    const loaded = getStory(story.id)
    expect(loaded?.title).toBe('My Novel Title')
    expect(loaded?.outputDir).toBe(originalOutputDir)
  })
})
