import { describe, expect, it } from 'vitest'
import {
  reconcileOutlineWithState,
} from '../../src/utils/outline-boundary.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { PendingTask } from '../../src/types/story-state.js'

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
    story: { id: 'story-1', title: 'Story', outputDir: '/tmp/story' },
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

describe('reconcileOutlineWithState filters stale pending tasks', () => {
  it('does not inject expired future plans from previous chapter', () => {
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

    const hint = reconcileOutlineWithState(state, 6)

    expect(hint).toBe('')
  })

  it('includes tasks whose description overlaps with current outline', () => {
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

    const hint = reconcileOutlineWithState(state, 6)

    expect(hint).toContain('陈裕堂登门拜访苏半城')
    expect(hint).not.toContain('回话亲王')
  })

  it('includes tasks explicitly due at the current chapter', () => {
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

    const hint = reconcileOutlineWithState(state, 6)

    expect(hint).toContain('第三日清晨出发')
  })

  it('advises postponement when pending task conflicts with core event', () => {
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

    const hint = reconcileOutlineWithState(state, 6)

    expect(hint).toContain('回话亲王')
    expect(hint).toContain('postponed')
    expect(hint).toContain('核心事件')
    expect(hint).toContain('不得以"差事今日到期"为由把无关差事扩展为独立大场景')
  })
})
