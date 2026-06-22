import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fix_chapter } from '../../src/graph/nodes.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { Issue } from '../../src/types/agent.js'

const buildState = (outputDir: string, pendingIssues: Issue[]): ReducedGraphState => ({
  story: { id: 'test', title: 'Test', outputDir, genre: 'default', totalChapters: 10 },
  idea: 'test',
  genre: 'default',
  totalChapters: 10,
  currentChapterIndex: 3,
  chapters: [{ id: '1', storyId: 'test', number: 4, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 }],
  chapterSummaries: [],
  foreshadowStack: [],
  outline: [
    { title: '一', description: 'a' },
    { title: '二', description: 'b' },
    { title: '三', description: 'c' },
    { title: '王府递帖', description: '递帖' },
  ],
  characters: [],
  world: null,
  storyState: null,
  pendingIssues,
} as unknown as ReducedGraphState)

describe('fix_chapter warning filtering', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(process.cwd(), 'tests', 'tmp', `fix-chapter-${Date.now()}`)
    await fs.mkdir(path.join(tmpDir, 'chapters'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'chapters', 'chapter_4.md'), '# 第四章 王府递帖\n\n正文第一段。\n\n正文第二段。', 'utf-8')
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('does not invoke FixAgent when all issues are abstract quality warnings', async () => {
    const state = buildState(tmpDir, [
      { id: '1', type: 'quality', severity: 'warning', description: '情感层次略显单一' },
    ])

    const result = await fix_chapter(state)
    expect(result.chapters).toEqual(state.chapters)
  })
})
