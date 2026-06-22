import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { runLegacyFix } from '../../src/graph/nodes.js'
import type { ReducedGraphState } from '../../src/graph/state.js'

const buildState = (outputDir: string): ReducedGraphState => ({
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
  pendingIssues: [],
} as unknown as ReducedGraphState)

describe('runLegacyFix validation', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(process.cwd(), 'tests', 'tmp', `legacy-fix-${Date.now()}`)
    await fs.mkdir(path.join(tmpDir, 'chapters'), { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('does not write revision plan content to chapter file', async () => {
    const outputDir = tmpDir
    const existingContent = '# 第四章 王府递帖\n\n旧正文。'
    const planContent = '=== FIXED_CHAPTER ===\n# 第四章 王府递帖\n\n问题分析：情感层次单一。修复建议：应该增加哭泣描写。' + '可以加入陆福的安慰。'.repeat(400) + '\n=== END_FIXED_CHAPTER ==='

    const agent = {
      run: vi.fn().mockResolvedValue({ success: true, content: planContent }),
    }

    const state = buildState(outputDir)
    await fs.writeFile(path.join(outputDir, 'chapters', 'chapter_4.md'), existingContent, 'utf-8')

    await expect(
      runLegacyFix(agent as never, state, existingContent, 3, state.outline[3], '前几章摘要', '时间线')
    ).rejects.toThrow('修改计划')

    const fileContent = await fs.readFile(path.join(outputDir, 'chapters', 'chapter_4.md'), 'utf-8')
    expect(fileContent).toBe(existingContent)
  })
})
