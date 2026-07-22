import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { draft_chapter } from '../../../src/graph/nodes/draft.js'
import { expandOutlineForChapter } from '../../../src/core/outline-expander.js'
import { getGenreSkill } from '../../../src/genres/registry.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import { createMockContext } from '../../utils/mock-context.ts'
import { countChineseWords } from '../../../src/utils/text.js'

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
  getGenreSkill: vi.fn((genreName: string) =>
    genreName === 'custom-genre'
      ? {
          chapterWordCountMin: 100,
          chapterWordCountMax: 1000,
          chapterPlanning: { chapterWordCountToleranceRatio: 0.05 },
        }
      : {
          chapterWordCountMin: 10,
          chapterWordCountMax: 100000,
        }
  ),
}))

function chapterContentWithWords(wordCount: number): string {
  const heading = '# 第1章 开篇\n\n'
  return `${heading}${'字'.repeat(wordCount - countChineseWords(heading))}`
}

describe('draft_chapter output validation', () => {
  let tmpDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    // clearAllMocks 不会清除 mock 实现，跨测试重新建立默认实现，避免单个测试的
    // mockReturnValue 泄漏到后续测试。
    vi.mocked(getGenreSkill).mockImplementation((genreName: string) =>
      genreName === 'custom-genre'
        ? ({
            chapterWordCountMin: 100,
            chapterWordCountMax: 1000,
            chapterPlanning: { chapterWordCountToleranceRatio: 0.05 },
          } as ReturnType<typeof getGenreSkill>)
        : ({
            chapterWordCountMin: 10,
            chapterWordCountMax: 100000,
          } as ReturnType<typeof getGenreSkill>)
    )
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

  it('rejects overlong generated content at draft stage after retries', async () => {
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
    chapterAgentRunMock.mockResolvedValue({
      success: true,
      content: `# 第1章 开篇\n\n${'超长正文'.repeat(3000)}`,
    })
    vi.mocked(getGenreSkill).mockReturnValue({
      chapterWordCountMin: 10,
      chapterWordCountMax: 5000,
    } as ReturnType<typeof getGenreSkill>)

    await expect(draft_chapter(createMockContext(), state)).rejects.toThrow(/超过上限/)
    expect(chapterAgentRunMock).toHaveBeenCalledTimes(3)
  })

  it('retries drafting with validation feedback when word count is below minimum', async () => {
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
      content: '太短了。',
    })

    const result = await draft_chapter(createMockContext(), state)

    expect(result).toBeDefined()
    expect(chapterAgentRunMock).toHaveBeenCalledTimes(2)
    const secondInput = chapterAgentRunMock.mock.calls[1]?.[0] as {
      issues?: Array<{ ruleId?: string; description?: string }>
    }
    const feedback = secondInput.issues?.find((i) => i.ruleId === 'draft.output-validation')
    expect(feedback).toBeDefined()
    expect(feedback?.description).toContain('低于最低要求')

    const written = await fs.readFile(
      path.join(tmpDir, '.staging', 'chapters', 'chapter_1.md'),
      'utf8'
    )
    expect(written).toContain('缺少章节标题的正文内容')
  })

  it('throws after exhausting draft validation retries', async () => {
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
    chapterAgentRunMock.mockResolvedValue({
      success: true,
      content: '太短了。',
    })

    await expect(draft_chapter(createMockContext(), state)).rejects.toThrow(/低于最低要求/)
    expect(chapterAgentRunMock).toHaveBeenCalledTimes(3)
    await expect(
      fs.readFile(path.join(tmpDir, '.staging', 'chapters', 'chapter_1.md'), 'utf8')
    ).rejects.toThrow()
  })

  it.each([
    { wordCount: 1050, accepted: true },
    { wordCount: 1051, accepted: false },
  ])(
    'uses the configured effective maximum at draft stage: $wordCount',
    async ({ wordCount, accepted }) => {
      const state = {
        story: { id: 'test', title: 'Test', outputDir: tmpDir },
        idea: 'test',
        genre: 'custom-genre',
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
      chapterAgentRunMock.mockResolvedValue({
        success: true,
        content: chapterContentWithWords(wordCount),
      })

      const result = draft_chapter(createMockContext(), state)
      if (accepted) {
        await expect(result).resolves.toBeDefined()
      } else {
        await expect(result).rejects.toThrow(/超过上限 1050/)
      }
    }
  )

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

  it('leaves missing expected events absent for structured validation', async () => {
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

    expect(result.draftChapterEvents).toEqual([])

    const written = await fs.readFile(
      path.join(tmpDir, '.staging', 'chapters', 'chapter_1.md'),
      'utf8'
    )
    expect(written).not.toContain('character-location: c-hero -> loc-home')
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
