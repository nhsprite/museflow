import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { draft_chapter } from '../../../src/graph/nodes/draft.js'
import { expandOutlineForChapter } from '../../../src/core/outline-expander.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import { createMockContext } from '../../utils/mock-context.ts'

const chapterAgentRunMock = vi.fn(async () => ({
  success: true,
  content: '缺少章节标题的正文内容，只有几句话。',
}))

vi.mock('../../../src/core/outline-expander.js', () => ({
  expandOutlineForChapter: vi.fn(async () => ({
    chapterPlan: {
      chapterIndex: 0,
      sections: [],
      timeline: [],
      outlineCheck: [],
      expectedEvents: [],
      claimedBeatIds: [],
      fulfilledForeshadowIds: [],
      introducedForeshadowIds: [],
      resolvedTaskIds: [],
      createdTaskIds: [],
    },
    boundaryHints: [],
    pendingIssues: [],
  })),
}))

vi.mock('../../../src/graph/agent-factory.js', () => ({
  getChapterAgent: vi.fn(() => ({
    run: chapterAgentRunMock,
  })),
}))

describe('draft_chapter output validation', () => {
  let tmpDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    chapterAgentRunMock.mockResolvedValue({
      success: true,
      content: '缺少章节标题的正文内容，只有几句话。',
    })
    tmpDir = path.join(process.cwd(), 'tests', 'tmp', `draft-chapter-${Date.now()}`)
    await fs.mkdir(path.join(tmpDir, 'chapters'), { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('throws when generated content lacks chapter heading', { timeout: 20000 }, async () => {
    const state = {
      story: { id: 'test', title: 'Test', outputDir: tmpDir },
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      currentChapterIndex: 0,
      outline: [{ title: '开篇', description: '测试' }],
      chapters: [],
      chapterSummaries: [],
      foreshadowStack: [],
      characters: [],
      world: null,
      storyState: null,
      pendingIssues: [],
      rewriteApproved: false,
    } as unknown as ReducedGraphState

    await expect(draft_chapter(createMockContext(), state)).rejects.toThrow(/起草后校验失败/)
  })

  it(
    'uses updated JIT outline after outline expansion when adding a missing heading',
    { timeout: 20000 },
    async () => {
      const state = {
        story: { id: 'test', title: 'Test', outputDir: tmpDir },
        idea: 'test',
        genre: 'default',
        totalChapters: 10,
        currentChapterIndex: 0,
        outline: [{ number: 1, title: '', description: '' }],
        chapters: [null],
        chapterSummaries: [],
        foreshadowStack: [],
        characters: [],
        world: null,
        storyState: null,
        pendingIssues: [],
        rewriteApproved: false,
        rewriteRequested: false,
        isWriting: true,
        writeOneChapterOnly: true,
        lastPrintedChapter: 0,
        lastTimelineSnapshot: null,
        chapterPlan: null,
      } as unknown as ReducedGraphState
      const updatedOutline = [{ number: 1, title: '即时标题', description: '即时生成描述' }]
      vi.mocked(expandOutlineForChapter).mockResolvedValueOnce({
        chapterPlan: {
          chapterIndex: 0,
          sections: [],
          timeline: [],
          outlineCheck: [],
          expectedEvents: [],
          claimedBeatIds: [],
          fulfilledForeshadowIds: [],
          introducedForeshadowIds: [],
          resolvedTaskIds: [],
          createdTaskIds: [],
        },
        boundaryHints: [],
        pendingIssues: [],
        outline: updatedOutline,
      })
      chapterAgentRunMock.mockResolvedValueOnce({
        success: true,
        content: '主角走在路上，心中思绪万千。'.repeat(600),
      })

      const result = await draft_chapter(createMockContext(), state)
      const written = await fs.readFile(path.join(tmpDir, 'chapters', 'chapter_1.md'), 'utf8')

      expect(written.startsWith('# 第1章 即时标题')).toBe(true)
      expect(result.chapters?.[0]?.outline).toBe('即时生成描述')
    }
  )
})
