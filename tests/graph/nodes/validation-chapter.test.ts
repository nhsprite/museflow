import { describe, expect, it, vi } from 'vitest'
import { validate_chapter, pruneRerunDetectorIssues } from '../../../src/graph/nodes/validation.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { Issue } from '../../../src/types/agent.js'
import type { RuntimeContext } from '../../../src/core/context.js'

vi.mock('../../../src/storage/filesystem/writer.js', () => ({
  readChapterContent: vi.fn(),
  readChapterContentForRun: vi.fn(),
  writeChapterContent: vi.fn(),
}))

import { readChapterContentForRun } from '../../../src/storage/filesystem/writer.js'

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
    vi.mocked(readChapterContentForRun).mockResolvedValueOnce(
      '这是足够长的正文内容，字数应该超过最低要求。'.repeat(100)
    )

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
    vi.mocked(readChapterContentForRun).mockResolvedValueOnce('太短')

    const state = makeState({ pendingIssues: [oldIssue] })
    const result = await validate_chapter(context, state)

    expect(result.pendingIssues).toHaveLength(1)
    expect(result.pendingIssues![0]!.type).toBe('word_count')
    expect(result.pendingIssues!.some((i) => i.id === 'old-1')).toBe(false)
  })

  it('treats chapters above the word count max as fix-retry errors', async () => {
    vi.mocked(readChapterContentForRun).mockResolvedValueOnce('超'.repeat(8001))

    const state = makeState()
    const result = await validate_chapter(context, state)

    expect(result.pendingIssues).toEqual([
      expect.objectContaining({
        type: 'word_count',
        severity: 'error',
        retryStrategy: 'fix',
      }),
    ])
    expect(result.pendingIssues?.[0]?.description).toContain('超过上限 8000')
  })
})

describe('pruneRerunDetectorIssues', () => {
  it('removes issues from rerun detector sources while preserving other sources', () => {
    const wordCountIssue: Issue = {
      id: 'w1',
      type: 'word_count',
      severity: 'warning',
      description: '字数差异',
      source: 'word_count',
    }
    const consistencyIssue: Issue = {
      id: 'c1',
      type: 'consistency',
      severity: 'error',
      description: '上一轮一致性错误',
      source: 'consistency',
    }
    const structuredIssue: Issue = {
      id: 's1',
      type: 'event_missing',
      severity: 'error',
      description: '结构化事件缺失',
      source: 'outline_compliance',
    }
    const untaggedIssue: Issue = {
      id: 'u1',
      type: 'outline_gap',
      severity: 'warning',
      description: '无来源标记的问题',
    }

    const result = pruneRerunDetectorIssues([
      wordCountIssue,
      consistencyIssue,
      structuredIssue,
      untaggedIssue,
    ])

    expect(result.map((i) => i.id)).toEqual(['s1', 'u1'])
  })

  it('returns empty array when all issues come from rerun detectors', () => {
    const issues: Issue[] = [
      {
        id: 'w1',
        type: 'word_count',
        severity: 'warning',
        description: '字数差异',
        source: 'word_count',
      },
      {
        id: 'c1',
        type: 'continuity',
        severity: 'error',
        description: '承接断裂',
        source: 'consistency',
      },
    ]
    expect(pruneRerunDetectorIssues(issues)).toHaveLength(0)
  })
})
