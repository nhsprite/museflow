import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fix_chapter } from '../../src/graph/nodes/fix.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { Issue } from '../../src/types/agent.js'
import type { StoryEvent } from '../../src/types/story-memory.js'
import type { RuntimeContext } from '../../src/core/context.ts'
import { createMockContext } from '../utils/mock-context.ts'

const buildState = (
  outputDir: string,
  pendingIssues: Issue[],
  extras: Partial<ReducedGraphState> = {}
): ReducedGraphState =>
  ({
    story: { id: 'test', title: 'Test', outputDir, genre: 'default', totalChapters: 10 },
    idea: 'test',
    genre: 'default',
    totalChapters: 10,
    currentChapterIndex: 3,
    chapters: [
      {
        id: '1',
        storyId: 'test',
        number: 4,
        title: null,
        outline: null,
        summary: null,
        foreshadows: null,
        status: 'drafting',
        createdAt: 0,
        updatedAt: 0,
      },
    ],
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
    ...extras,
  }) as unknown as ReducedGraphState

describe('fix_chapter warning filtering', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(process.cwd(), 'tests', 'tmp', `fix-chapter-${Date.now()}`)
    await fs.mkdir(path.join(tmpDir, 'chapters'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'chapters', 'chapter_4.md'),
      '# 第四章 王府递帖\n\n正文第一段。\n\n正文第二段。',
      'utf-8'
    )
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('does not invoke FixAgent when all issues are abstract quality warnings', async () => {
    const state = buildState(tmpDir, [
      { id: '1', type: 'quality', severity: 'warning', description: '情感层次略显单一' },
    ])

    const result = await fix_chapter(createMockContext(), state)
    expect(result.chapters).toEqual(state.chapters)
  })
})

describe('fix_chapter draftChapterEvents refresh', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(process.cwd(), 'tests', 'tmp', `fix-events-${Date.now()}`)
    await fs.mkdir(path.join(tmpDir, 'chapters'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'chapters', 'chapter_4.md'),
      '# 第四章 王府递帖\n\n正文第一段。\n\n正文第二段。',
      'utf-8'
    )
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('drops events whose evidence is out of range after legacy rewrite and emits a warning', async () => {
    const keptEvent: StoryEvent = {
      id: 'evt-keep',
      type: 'character-location',
      characterId: 'c1',
      locationId: 'l1',
      chapterIndex: 3,
      source: 'chapter',
      evidence: { paragraphIndex: 1 },
    }
    const staleEvent: StoryEvent = {
      id: 'evt-drop',
      type: 'character-location',
      characterId: 'c2',
      locationId: 'l2',
      chapterIndex: 3,
      source: 'chapter',
      evidence: { paragraphIndex: 2 },
    }
    const state = buildState(
      tmpDir,
      [{ id: '1', type: 'consistency', severity: 'error', description: '状态矛盾' }],
      { draftChapterEvents: [keptEvent, staleEvent] }
    )

    // 无 locationRef → legacy 模式；修复后正文只剩 1 个正文段落，@p2 证据失效。
    const context = createMockContext(
      '=== FIXED_CHAPTER ===\n# 第四章 王府递帖\n\n唯一新段落。\n=== END_FIXED_CHAPTER ==='
    )
    const result = await fix_chapter(context, state)

    expect(result.draftChapterEvents).toEqual([keptEvent])
    expect(
      result.pendingIssues?.some(
        (issue) =>
          issue.type === 'event_evidence_invalid' &&
          issue.severity === 'warning' &&
          issue.description.includes('evt-drop')
      )
    ).toBe(true)
  })
})

describe('fix_chapter previous chapter ending context', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(process.cwd(), 'tests', 'tmp', `fix-prev-ending-${Date.now()}`)
    await fs.mkdir(path.join(tmpDir, 'chapters'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'chapters', 'chapter_3.md'),
      '# 第三章 夜谈\n\n上一章第一段。\n\n上一章最后一段。',
      'utf-8'
    )
    await fs.writeFile(
      path.join(tmpDir, 'chapters', 'chapter_4.md'),
      '# 第四章 王府递帖\n\n正文第一段。\n\n正文第二段。',
      'utf-8'
    )
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('includes the previous chapter ending snippet in the fix prompt', async () => {
    const state = buildState(tmpDir, [
      {
        id: '1',
        type: 'consistency',
        severity: 'error',
        description: '段落矛盾',
        locationRef: { paragraphIndex: 1 },
      },
    ])

    const context = createMockContext('【段落 1】\n修改后的第一段。')
    await fix_chapter(context, state)

    const chatMock = context.provider.chat as ReturnType<typeof vi.fn>
    const allMessages = chatMock.mock.calls.flatMap((call) => call[0] as Array<{ content: string }>)
    expect(
      allMessages.some(
        (message) =>
          message.content.includes('【上一章结尾片段】') &&
          message.content.includes('上一章最后一段。')
      )
    ).toBe(true)
  })
})

describe('fix_chapter paragraph patch safeguards', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(process.cwd(), 'tests', 'tmp', `fix-safeguard-${Date.now()}`)
    await fs.mkdir(path.join(tmpDir, 'chapters'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'chapters', 'chapter_4.md'),
      '# 第四章 王府递帖\n\n正文第一段。\n\n正文第二段。',
      'utf-8'
    )
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  const paragraphIssue: Issue = {
    id: '1',
    type: 'consistency',
    severity: 'error',
    description: '段落矛盾',
    locationRef: { paragraphIndex: 1 },
  }

  it('rejects empty paragraph patches and keeps the original content', async () => {
    const state = buildState(tmpDir, [paragraphIssue])

    const context = createMockContext('【段落 1】\n   ')
    const result = await fix_chapter(context, state)

    const staged = await fs.readFile(
      path.join(tmpDir, '.staging', 'chapters', 'chapter_4.md'),
      'utf-8'
    )
    expect(staged).toContain('正文第一段。')
    expect(
      result.pendingIssues?.some(
        (issue) =>
          issue.severity === 'warning' &&
          issue.locationRef?.paragraphIndex === 1 &&
          issue.description.includes('空内容')
      )
    ).toBe(true)
  })

  it('turns invalid merged content into a draft-retry issue instead of writing it', async () => {
    const state = buildState(tmpDir, [paragraphIssue])

    const context: RuntimeContext = {
      ...createMockContext('【段落 1】\n修改后的第一段。'),
      provider: {
        chat: vi.fn().mockResolvedValue('【段落 1】\n修改后的第一段。'),
        chatStructured: vi.fn().mockResolvedValue({
          results: [{ looksLikeRevisionPlan: true, containsChecklistArtifacts: false }],
        }),
      },
    }
    const result = await fix_chapter(context, state)

    expect(result.chapters).toBeUndefined()
    expect(
      result.pendingIssues?.some(
        (issue) =>
          issue.type === 'draft_failure' &&
          issue.severity === 'error' &&
          issue.retryStrategy === 'draft'
      )
    ).toBe(true)
    await expect(
      fs.access(path.join(tmpDir, '.staging', 'chapters', 'chapter_4.md'))
    ).rejects.toThrow()
  })
})
