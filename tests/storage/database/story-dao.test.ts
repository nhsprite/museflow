import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createStory, getStory, updateStoryStatus, updateStoryTitle } from '../../../src/storage/database/dao/story.ts'
import { getStoryOutputDir } from '../../../src/utils/paths.js'

describe('story DAO', () => {
  const createdStories: Array<{ id: string; outputDir: string }> = []

  beforeEach(async () => {
    for (const story of ['story_test1', 'story_test2', 'story_test3']) {
      await rm(join(process.cwd(), 'books', story), { force: true, recursive: true }).catch(() => {})
    }
  })

  afterEach(async () => {
    await Promise.all(
      createdStories.splice(0).map(({ outputDir }) => rm(outputDir, { force: true, recursive: true }))
    )
  })

  it('should create and retrieve a story', async () => {
    const story = createStory({
      title: 'Hello 世界!!! / test',
      idea: 'test idea',
      genre: 'fantasy',
      totalChapters: 10,
    })
    createdStories.push({ id: story.id, outputDir: story.outputDir })
    expect(story.id).toBeDefined()
    expect(story.title).toBe('Hello 世界!!! / test')
    expect(story.idea).toBe('test idea')
    expect(story.genre).toBe('fantasy')
    expect(story.totalChapters).toBe(10)
    expect(story.status).toBe('init')
    expect(story.outputDir).toBe(getStoryOutputDir(story.id, story.title))

    const loaded = getStory(story.id)
    expect(loaded).not.toBeNull()
    expect(loaded?.title).toBe('Hello 世界!!! / test')
    expect(loaded?.idea).toBe('test idea')
    expect(loaded?.outputDir).toBe(story.outputDir)
  })

  it('should use untitled for missing or blank titles', async () => {
    const untitled = createStory({ idea: 'test', genre: 'fantasy', totalChapters: 3 })
    createdStories.push({ id: untitled.id, outputDir: untitled.outputDir })
    expect(untitled.outputDir).toBe(getStoryOutputDir(untitled.id, undefined))
  })

  it('should update story status', async () => {
    const story = createStory({ idea: 'test', genre: 'scifi', totalChapters: 5 })
    createdStories.push({ id: story.id, outputDir: story.outputDir })
    updateStoryStatus(story.id, 'worldbuilding')
    const loaded = getStory(story.id)
    expect(loaded?.status).toBe('worldbuilding')
  })

  it('should update story title', async () => {
    const story = createStory({ idea: 'test', genre: 'xianxia', totalChapters: 20 })
    createdStories.push({ id: story.id, outputDir: story.outputDir })
    const originalOutputDir = story.outputDir
    updateStoryTitle(story.id, 'My Novel Title')
    const loaded = getStory(story.id)
    expect(loaded?.title).toBe('My Novel Title')
    expect(loaded?.outputDir).toBe(originalOutputDir)
  })
})
