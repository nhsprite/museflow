import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rm } from 'node:fs/promises'
import { initDb, closeDb } from '../../../src/storage/database/index.ts'
import { createStory } from '../../../src/storage/database/dao/story.ts'
import { saveOutline, getOutline } from '../../../src/storage/database/dao/chapter.ts'

const TEST_DB = '/tmp/museflow_chapter_test.sqlite'

describe('chapter DAO outline persistence', () => {
  beforeEach(async () => {
    await rm(TEST_DB, { force: true }).catch(() => {})
    await initDb(TEST_DB)
  })

  afterEach(() => {
    closeDb()
  })

  it('should persist outline to outline table via saveOutline', () => {
    const story = createStory({ idea: 'test', genre: 'xianxia', totalChapters: 3 })
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
    const loaded = getOutline(story.id)
    expect(loaded).toHaveLength(0)
  })
})
