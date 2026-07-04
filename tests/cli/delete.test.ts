import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Story } from '../../src/types/story.ts'

const getStoryMock = vi.fn<() => Story | null>()
const deleteStoryMock = vi.fn<() => boolean>()
const tempDir = join(tmpdir(), `museflow-delete-${randomUUID().slice(0, 8)}`)

vi.mock('../../src/storage/meta/stores/story.ts', () => ({
  getStory: getStoryMock,
  deleteStory: deleteStoryMock,
  initStoryDb: vi.fn().mockResolvedValue(undefined),
}))

function createStory(id: string, title: string): Story {
  return {
    id,
    title,
    idea: 'test idea',
    genre: 'fantasy',
    totalChapters: 3,
    status: 'writing',
    provider: 'openai',
    outputDir: `${tempDir}/${id}`,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('delete command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows confirmation without force flag', async () => {
    getStoryMock.mockReturnValue(createStory('story-1', 'Test Story'))
    const { del } = await import('../../src/cli/commands/delete.ts')

    await del('story-1')

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('即将删除'))
    expect(deleteStoryMock).not.toHaveBeenCalled()
  })

  it('deletes story with force flag', async () => {
    getStoryMock.mockReturnValue(createStory('story-1', 'Test Story'))
    deleteStoryMock.mockReturnValue(true)
    const { del } = await import('../../src/cli/commands/delete.ts')

    await del('story-1', { force: true })

    expect(deleteStoryMock).toHaveBeenCalledWith('story-1')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('已删除'))
  })

  it('exits when story not found', async () => {
    getStoryMock.mockReturnValue(null)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })
    const { del } = await import('../../src/cli/commands/delete.ts')

    await expect(del('missing')).rejects.toThrow('exit')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('不存在'))

    exitSpy.mockRestore()
  })
})
