import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { draft_chapter } from '../../../src/graph/nodes/draft.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import { createMockContext } from '../../utils/mock-context.ts'

vi.mock('../../../src/core/outline-expander.js', () => ({
  expandOutlineForChapter: vi.fn(async () => ({
    chapterPlan: { sections: [], timeline: [], outlineCheck: [] },
    boundaryHints: [],
    pendingIssues: [],
  })),
}))

vi.mock('../../../src/graph/agent-factory.js', () => ({
  getChapterAgent: vi.fn(() => ({
    run: vi.fn(async () => ({
      success: true,
      content: '缺少章节标题的正文内容，只有几句话。',
    })),
  })),
}))

describe('draft_chapter output validation', () => {
  let tmpDir: string

  beforeEach(async () => {
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
})
