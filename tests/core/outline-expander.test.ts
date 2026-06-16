import { describe, expect, it, vi } from 'vitest'
import { expandOutlineForChapter } from '../../src/core/outline-expander.js'
import type { ReducedGraphState } from '../../src/graph/state.js'

const { planChapterWithOverrideMock } = vi.hoisted(() => ({
  planChapterWithOverrideMock: vi.fn(),
}))

vi.mock('../../src/graph/nodes.js', () => ({
  plan_chapter_with_override: planChapterWithOverrideMock,
}))

const baseState: ReducedGraphState = {
  story: { id: 'story-1', title: 'Story', outputDir: '/tmp/story' },
  idea: 'idea',
  genre: 'default',
  totalChapters: 3,
  world: null,
  characters: [],
  outline: [
    { number: 1, title: '启程', description: '主角离开家乡。' },
    { number: 2, title: '遇敌', description: '主角遭遇敌人并暂时被困。' },
    { number: 3, title: '脱困', description: '主角脱困并反击。' },
  ],
  chapters: [null, null, null],
  currentChapterIndex: 1,
  foreshadowStack: [],
  chapterSummaries: ['第一章摘要'],
  pendingIssues: [],
  rewriteApproved: false,
  rewriteRequested: false,
  isWriting: true,
  writeOneChapterOnly: true,
  lastPrintedChapter: 0,
  lastTimelineSnapshot: null,
  chapterPlan: null,
  storyState: null,
  autoFixAttempts: 0,
}

describe('expandOutlineForChapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: { sections: [] } })
  })

  it('calls plan_chapter with current and next chapter arcs', async () => {
    await expandOutlineForChapter(baseState, 1)

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![1] as string
    expect(formattedOutline).toContain('第2章：遇敌')
    expect(formattedOutline).toContain('主角遭遇敌人并暂时被困')
    expect(formattedOutline).toContain('第3章"脱困"')
  })

  it('warns when current arc already resolves next arc event', async () => {
    const conflictState: ReducedGraphState = {
      ...baseState,
      outline: [
        { number: 1, title: '真假美猴王', description: '六耳猕猴伏法，真宝玉获救。' },
        { number: 2, title: '三界求援', description: '如来佛祖现身辨别六耳猕猴。' },
        { number: 3, title: '后续', description: '团队继续西行。' },
      ],
    }

    await expandOutlineForChapter(conflictState, 1)

    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![1] as string
    expect(formattedOutline).toContain('不得重复处理')
  })

  it('returns boundary hints', async () => {
    const result = await expandOutlineForChapter(baseState, 1)

    expect(result.boundaryHints.length).toBeGreaterThan(0)
    expect(result.chapterPlan).toBeDefined()
  })

  it('throws when plan_chapter returns no plan', async () => {
    planChapterWithOverrideMock.mockResolvedValueOnce({})
    await expect(expandOutlineForChapter(baseState, 1)).rejects.toThrow('详细计划生成失败')
  })
})
