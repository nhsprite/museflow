import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rm } from 'node:fs/promises'
import { initDb, closeDb } from '@/storage/database/index.ts'
import { createStory, getStory, updateStoryStatus, updateStoryTitle } from '@/storage/database/dao/story.ts'

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
    const story = createStory({ idea: 'test idea', genre: 'fantasy', totalChapters: 10 })
    expect(story.id).toBeDefined()
    expect(story.idea).toBe('test idea')
    expect(story.genre).toBe('fantasy')
    expect(story.totalChapters).toBe(10)
    expect(story.status).toBe('init')

    const loaded = getStory(story.id)
    expect(loaded).not.toBeNull()
    expect(loaded?.idea).toBe('test idea')
  })

  it('should update story status', async () => {
    const story = createStory({ idea: 'test', genre: 'scifi', totalChapters: 5 })
    updateStoryStatus(story.id, 'worldbuilding')
    const loaded = getStory(story.id)
    expect(loaded?.status).toBe('worldbuilding')
  })

  it('should update story title', async () => {
    const story = createStory({ idea: 'test', genre: 'xianxia', totalChapters: 20 })
    updateStoryTitle(story.id, 'My Novel Title')
    const loaded = getStory(story.id)
    expect(loaded?.title).toBe('My Novel Title')
  })
})
