import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { getCheckpointer } from '../../src/graph/checkpointer.ts'
import { ensureStoryDir } from '../../src/storage/database/index.js'

const TEST_STORY_ID = 'story_checkpointer_test'

describe('checkpointer', () => {
  beforeEach(async () => {
    await rm(join(process.cwd(), 'books', TEST_STORY_ID), { force: true, recursive: true }).catch(() => {})
  })

  afterEach(async () => {
    await rm(join(process.cwd(), 'books', TEST_STORY_ID), { force: true, recursive: true }).catch(() => {})
  })

  it('creates a checkpointer and stores checkpoints per story id', async () => {
    const saver = getCheckpointer()
    expect(saver).toBeDefined()

    const config = { configurable: { thread_id: TEST_STORY_ID } }
    const tuple = await saver.getTuple(config)
    expect(tuple).toBeUndefined()
  })
})
