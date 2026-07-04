import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as contextJudge from '../../src/utils/context-judge.js'
import {
  reconcileOutlineWithState,
} from '../../src/utils/outline-boundary.js'
import { DEFAULT_CHAPTER_PLANNING_CONFIG } from '../../src/utils/chapter-planning.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { PendingTask } from '../../src/types/story-state.js'
import type { ModelProvider } from '../../src/model/provider.js'

const tempDir = join(tmpdir(), `museflow-outline-boundary-${randomUUID().slice(0, 8)}`)

vi.mock('../../src/utils/context-judge.js', () => ({
  batchJudgeTaskRelevance: vi.fn().mockResolvedValue([]),
}))

function buildState(
  outlineDescription: string,
  pendingTasks: PendingTask[],
  chapterIndex = 6
): ReducedGraphState {
  const outline = Array.from({ length: chapterIndex + 2 }, (_, i) => ({
    number: i + 1,
    title: `第${i + 1}章`,
    description: i === chapterIndex ? outlineDescription : '过渡章节内容。',
  }))

  return {
    story: { id: 'story-1', title: 'Story', outputDir: tempDir },
    idea: 'idea',
    genre: 'default',
    totalChapters: 10,
    world: null,
    characters: [],
    outline,
    chapters: [],
    currentChapterIndex: chapterIndex,
    foreshadowStack: [],
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: false,
    writeOneChapterOnly: false,
    lastPrintedChapter: 0,
    lastTimelineSnapshot: null,
    chapterPlan: null,
    storyState: {
      characterLocations: {},
      characterStatus: {},
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks,
      currentScene: '',
      storyTime: '',
    },
    autoFixAttempts: 0,
  }
}

function createProvider(): ModelProvider {
  return { chat: vi.fn() }
}

describe('reconcileOutlineWithState filters stale pending tasks', () => {
  it('does not inject expired future plans from previous chapter', async () => {
    const state = buildState('买办商人陈裕堂主动登门。', [
      {
        id: 't1',
        assignee: '苏半城',
        description: '明日午时前回话亲王',
        createdChapter: 6,
        dueChapter: 7,
        status: 'expired',
      },
      {
        id: 't2',
        assignee: '苏半城',
        description: '明日卯时请协成永大掌柜来正房理账',
        createdChapter: 6,
        dueChapter: 7,
        status: 'expired',
      },
    ])

    const hint = await reconcileOutlineWithState(state, 6, DEFAULT_CHAPTER_PLANNING_CONFIG)

    expect(hint).toBe('')
  })

  it('includes tasks judged relevant by the model', async () => {
    const state = buildState('买办商人陈裕堂主动登门，自称愿以洋行势力相助翻案。', [
      {
        id: 't1',
        assignee: '苏半城',
        description: '陈裕堂登门拜访苏半城',
        createdChapter: 6,
        status: 'pending',
      },
      {
        id: 't2',
        assignee: '苏半城',
        description: '明日午时前回话亲王',
        createdChapter: 6,
        dueChapter: 7,
        status: 'expired',
      },
    ])

    vi.mocked(contextJudge.batchJudgeTaskRelevance).mockResolvedValueOnce([true])
    const hint = await reconcileOutlineWithState(state, 6, DEFAULT_CHAPTER_PLANNING_CONFIG, createProvider())

    expect(hint).toContain('陈裕堂登门拜访苏半城')
    expect(hint).not.toContain('回话亲王')
  })

  it('includes tasks explicitly due at the current chapter', async () => {
    const state = buildState('主角在客栈休息。', [
      {
        id: 't1',
        assignee: '主角',
        description: '第三日清晨出发',
        createdChapter: 5,
        dueChapter: 7,
        status: 'pending',
      },
    ])

    const hint = await reconcileOutlineWithState(state, 6, DEFAULT_CHAPTER_PLANNING_CONFIG)

    expect(hint).toContain('第三日清晨出发')
  })

  it('advises postponement when pending task conflicts with core event', async () => {
    const state = buildState('买办商人陈裕堂主动登门。', [
      {
        id: 't1',
        assignee: '苏半城',
        description: '明日午时前回话亲王',
        createdChapter: 6,
        dueChapter: 7,
        status: 'pending',
      },
    ])

    vi.mocked(contextJudge.batchJudgeTaskRelevance).mockResolvedValueOnce([false])
    const hint = await reconcileOutlineWithState(state, 6, DEFAULT_CHAPTER_PLANNING_CONFIG, createProvider())

    expect(hint).toContain('回话亲王')
    expect(hint).toContain('postponed')
    expect(hint).toContain('核心事件')
    expect(hint).toContain('不得以"差事今日到期"为由把无关差事扩展为独立大场景')
  })
})
