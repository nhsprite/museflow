import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { draft_chapter } from '../../../src/graph/nodes/draft.js'
import { expandOutlineForChapter } from '../../../src/core/outline-expander.js'
import { getGenreSkill } from '../../../src/genres/registry.js'
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

vi.mock('../../../src/genres/registry.js', () => ({
  getGenreSkill: vi.fn(() => ({
    chapterWordCountMin: 10,
    chapterWordCountMax: 100000,
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

  it('writes short generated content so word-count validation can route it', async () => {
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

    await expect(draft_chapter(createMockContext(), state)).resolves.toBeDefined()

    const written = await fs.readFile(
      path.join(tmpDir, '.staging', 'chapters', 'chapter_1.md'),
      'utf8'
    )
    expect(written.startsWith('# 第1章 开篇')).toBe(true)
  })

  it('rejects overlong generated content at draft stage', async () => {
    const state = {
      story: { id: 'test', title: 'Test', outputDir: tmpDir },
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      currentChapterIndex: 0,
      outline: [{ number: 1, title: '开篇', description: '测试' }],
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
    chapterAgentRunMock.mockResolvedValueOnce({
      success: true,
      content: `# 第1章 开篇\n\n${'超长正文'.repeat(3000)}`,
    })
    vi.mocked(getGenreSkill).mockReturnValueOnce({
      chapterWordCountMin: 10,
      chapterWordCountMax: 5000,
    } as ReturnType<typeof getGenreSkill>)

    await expect(draft_chapter(createMockContext(), state)).rejects.toThrow(/超过上限/)
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
      const expandedChapterPlan = {
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
      }
      vi.mocked(expandOutlineForChapter).mockResolvedValueOnce({
        chapterPlan: expandedChapterPlan,
        boundaryHints: [],
        pendingIssues: [],
        outline: updatedOutline,
      })
      chapterAgentRunMock.mockResolvedValueOnce({
        success: true,
        content: '主角走在路上，心中思绪万千。'.repeat(600),
      })

      const result = await draft_chapter(createMockContext(), state)
      const written = await fs.readFile(
        path.join(tmpDir, '.staging', 'chapters', 'chapter_1.md'),
        'utf8'
      )

      expect(written.startsWith('# 第1章 即时标题')).toBe(true)
      expect(result.chapters?.[0]?.outline).toBe('即时生成描述')
      expect(result.chapterPlan).toEqual(expandedChapterPlan)
    }
  )

  it('normalizes model-generated chapter heading numbers before validation', async () => {
    const outline = Array.from({ length: 16 }, (_, i) => ({
      number: i + 1,
      title: i === 15 ? '第十七页的空白' : `第${i + 1}章`,
      description: i === 15 ? '本章围绕第十七页的空白展开。' : '',
    }))
    const state = {
      story: { id: 'test', title: 'Test', outputDir: tmpDir },
      idea: 'test',
      genre: 'default',
      totalChapters: 50,
      currentChapterIndex: 15,
      outline,
      chapters: Array(16).fill(null),
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
    chapterAgentRunMock.mockResolvedValueOnce({
      success: true,
      content: `# 第17章 第十七页的空白\n\n${'林屿低头看着纸页上的空白，笔尖悬在格线上。'.repeat(300)}`,
    })

    await draft_chapter(createMockContext(), state)
    const written = await fs.readFile(
      path.join(tmpDir, '.staging', 'chapters', 'chapter_16.md'),
      'utf8'
    )
    expect(written.startsWith('# 第16章 第十七页的空白')).toBe(true)
  })

  it('auto-completes missing expected events in the STORY_EVENTS block', async () => {
    const state = {
      story: { id: 'test', title: 'Test', outputDir: tmpDir },
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      currentChapterIndex: 0,
      outline: [{ number: 1, title: '开篇', description: '测试' }],
      chapters: [null],
      chapterSummaries: [],
      foreshadowStack: [],
      characters: [],
      world: null,
      storyState: null,
      pendingIssues: [],
      rewriteApproved: false,
    } as unknown as ReducedGraphState
    vi.mocked(expandOutlineForChapter).mockResolvedValueOnce({
      chapterPlan: {
        chapterIndex: 0,
        sections: [],
        timeline: [],
        outlineCheck: [],
        expectedEvents: [
          {
            id: 'evt-expected',
            type: 'character-location',
            characterId: 'c-hero',
            locationId: 'loc-home',
            chapterIndex: 0,
            source: 'chapter',
          },
        ],
        claimedBeatIds: [],
        fulfilledForeshadowIds: [],
        introducedForeshadowIds: [],
        resolvedTaskIds: [],
        createdTaskIds: [],
      },
      boundaryHints: [],
      pendingIssues: [],
    })
    chapterAgentRunMock.mockResolvedValueOnce({
      success: true,
      content: `=== PRE_WRITE_CHECK ===
check

=== STORY_EVENTS ===

=== CHAPTER_CONTENT ===
# 第1章 开篇

主角回到家中。

=== STORY_FINAL_STATE ===
[]`,
    })

    const result = await draft_chapter(createMockContext(), state)

    expect(result.draftChapterEvents).toHaveLength(1)
    expect(result.draftChapterEvents?.[0]).toMatchObject({
      type: 'character-location',
      characterId: 'c-hero',
      locationId: 'loc-home',
    })

    const written = await fs.readFile(
      path.join(tmpDir, '.staging', 'chapters', 'chapter_1.md'),
      'utf8'
    )
    expect(written).toContain('character-location: c-hero -> loc-home')
  })

  it('returns canonical/superseded facts deltas from the reconciled state', async () => {
    const state = {
      story: { id: 'test', title: 'Test', outputDir: tmpDir },
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      currentChapterIndex: 0,
      outline: [{ number: 1, title: '开篇', description: '测试' }],
      chapters: [null],
      chapterSummaries: [],
      foreshadowStack: [],
      characters: [],
      world: null,
      storyState: null,
      pendingIssues: [],
      rewriteApproved: false,
    } as unknown as ReducedGraphState
    chapterAgentRunMock.mockResolvedValueOnce({
      success: true,
      content: '主角走在路上，心中思绪万千。'.repeat(50),
    })

    const result = await draft_chapter(createMockContext(), state)

    expect(Array.isArray(result.canonicalFactsDelta)).toBe(true)
    expect(Array.isArray(result.supersededFactsDelta)).toBe(true)
  })
})
