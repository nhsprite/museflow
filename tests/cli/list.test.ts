import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Story } from '../../src/types/story.ts'

const listStoriesMock = vi.fn<() => Story[]>()
const getStateMock = vi.fn<() => Promise<null>>()
const tempDir = join(tmpdir(), `museflow-list-${randomUUID().slice(0, 8)}`)

vi.mock('../../src/storage/meta/stores/story.ts', () => ({
  listStories: listStoriesMock,
}))

vi.mock('../../src/core/runner.ts', () => ({
  getState: getStateMock,
}))

function createStory(id: string, title: string, status: string): Story {
  return {
    id,
    title,
    idea: 'test idea',
    genre: 'fantasy',
    totalChapters: 3,
    status: status as Story['status'],
    provider: 'openai',
    outputDir: `${tempDir}/${id}`,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('list command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getStateMock.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows empty message when no stories exist', async () => {
    listStoriesMock.mockReturnValue([])
    const { list } = await import('../../src/cli/commands/list.ts')

    await list()

    expect(logSpy).toHaveBeenCalledWith('[MuseFlow] 暂无书籍')
  })

  it('shows story list with basic info', async () => {
    listStoriesMock.mockReturnValue([
      createStory('story-1', 'Test Story', 'writing'),
    ])
    const { list } = await import('../../src/cli/commands/list.ts')

    await list()

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('📚 书籍列表'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Test Story'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('story-1'))
  })
})
