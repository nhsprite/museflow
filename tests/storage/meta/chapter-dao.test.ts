import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createStory } from '../../../src/storage/meta/stores/story.ts'
import { saveOutline, getOutline } from '../../../src/storage/meta/stores/chapter.ts'

describe('chapter DAO outline persistence', () => {
  const createdStories: Array<{ id: string; outputDir: string }> = []

  beforeEach(async () => {
    await rm(join(process.cwd(), 'books', 'story_test1'), { force: true, recursive: true }).catch(() => {})
    await rm(join(process.cwd(), 'books', 'story_test2'), { force: true, recursive: true }).catch(() => {})
    await rm(join(process.cwd(), 'books', 'story_test3'), { force: true, recursive: true }).catch(() => {})
  })

  afterEach(async () => {
    await Promise.all(
      createdStories.splice(0).map(({ outputDir }) => rm(outputDir, { force: true, recursive: true }))
    )
  })

  it('should persist outline via saveOutline', () => {
    const story = createStory({ idea: 'test', genre: 'xianxia', totalChapters: 3 })
    createdStories.push({ id: story.id, outputDir: story.outputDir })
    const chapters = [
      { number: 1, title: '第一章', description: '少年觉醒' },
      { number: 2, title: '第二章', description: '入门修行' },
      { number: 3, title: '第三章', description: '初试锋芒' },
    ]
    saveOutline(story.id, chapters)

    const loaded = getOutline(story.id)
    expect(loaded).toHaveLength(3)
    expect(loaded[0]).toMatchObject({ number: 1, title: '第一章', description: '少年觉醒' })
    expect(loaded[1]).toMatchObject({ number: 2, title: '第二章', description: '入门修行' })
    expect(loaded[2]).toMatchObject({ number: 3, title: '第三章', description: '初试锋芒' })
  })

  it('should replace existing outline when saveOutline is called again', () => {
    const story = createStory({ idea: 'test', genre: 'xianxia', totalChapters: 2 })
    createdStories.push({ id: story.id, outputDir: story.outputDir })
    saveOutline(story.id, [
      { number: 1, title: '旧第一章', description: '旧描述' },
      { number: 2, title: '旧第二章', description: '旧描述' },
    ])

    saveOutline(story.id, [
      { number: 1, title: '新第一章', description: '新描述' },
    ])

    const loaded = getOutline(story.id)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({ number: 1, title: '新第一章', description: '新描述' })
  })

  it('should return empty array when no outline exists', () => {
    const story = createStory({ idea: 'test', genre: 'fantasy', totalChapters: 5 })
    createdStories.push({ id: story.id, outputDir: story.outputDir })
    const loaded = getOutline(story.id)
    expect(loaded).toHaveLength(0)
  })
})
