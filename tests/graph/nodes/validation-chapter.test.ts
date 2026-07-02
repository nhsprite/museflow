import { describe, expect, it, vi } from 'vitest'
import { validate_chapter } from '../../../src/graph/nodes/validation.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { Issue } from '../../../src/types/agent.js'
import type { RuntimeContext } from '../../../src/core/context.js'

vi.mock('../../../src/storage/filesystem/writer.js', () => ({
  readChapterContent: vi.fn(),
  writeChapterContent: vi.fn(),
}))

import { readChapterContent } from '../../../src/storage/filesystem/writer.js'

function makeState(overrides: Partial<ReducedGraphState> = {}): ReducedGraphState {
  return {
    story: { id: 'story-1', outputDir: '/tmp/test' } as ReducedGraphState['story'],
    currentChapterIndex: 0,
    pendingIssues: [],
    genre: 'default',
    totalChapters: 10,
    idea: 'test',
    outline: [],
    chapters: [],
    chapterSummaries: [],
    foreshadowStack: [],
    isWriting: true,
    writeOneChapterOnly: false,
    ...overrides,
  } as ReducedGraphState
}

const context = {} as RuntimeContext

describe('validate_chapter', () => {
  it('does not carry over existing pendingIssues when no new word count issues', async () => {
    const oldIssue: Issue = {
      id: 'old-1',
      type: 'consistency',
      severity: 'error',
      description: '已有问题',
    }
    vi.mocked(readChapterContent).mockResolvedValueOnce('这是足够长的正文内容，字数应该超过最低要求。'.repeat(100))

    const state = makeState({ pendingIssues: [oldIssue] })
    const result = await validate_chapter(context, state)

    expect(result.pendingIssues).toHaveLength(0)
  })

  it('returns only new word_count issues', async () => {
    const oldIssue: Issue = {
      id: 'old-1',
      type: 'consistency',
      severity: 'error',
      description: '已有问题',
    }
    vi.mocked(readChapterContent).mockResolvedValueOnce('太短')

    const state = makeState({ pendingIssues: [oldIssue] })
    const result = await validate_chapter(context, state)

    expect(result.pendingIssues).toHaveLength(1)
    expect(result.pendingIssues![0]!.type).toBe('word_count')
    expect(result.pendingIssues!.some(i => i.id === 'old-1')).toBe(false)
  })
})
