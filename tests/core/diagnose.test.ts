import { describe, expect, it } from 'vitest'
import { diagnoseStoryState } from '../../src/core/diagnose.ts'
import type { ReducedGraphState } from '../../src/graph/state.js'

function createMockState(outline: Array<{ number: number; title: string; description: string }>): ReducedGraphState {
  return {
    idea: 'test',
    genre: 'default',
    totalChapters: outline.length,
    currentChapterIndex: 0,
    outline,
    characters: [],
    world: undefined,
    chapterSummaries: [],
    foreshadowStack: [],
    pendingIssues: [],
    rewriteApproved: false,
    writeOneChapterOnly: false,
    story: {
      id: 'test-story',
      title: 'Test Story',
      idea: 'test',
      genre: 'default',
      totalChapters: outline.length,
      currentChapterIndex: 0,
      status: 'writing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      outputDir: '/tmp/test',
    } as unknown as ReducedGraphState['story'],
    chapterMetas: [],
    chapterPlans: [],
  } as unknown as ReducedGraphState
}

describe('diagnoseStoryState cross-chapter outline conflict detection', () => {
  it('detects terminal event followed by resolution requirement', async () => {
    const state = createMockState([
      { number: 1, title: 'First Chapter', description: '发生战斗' },
      { number: 2, title: '真假美猴王', description: '六耳猕猴伏法，真宝玉获救' },
      { number: 3, title: '三界求援', description: '如来佛祖现身，辨别六耳猕猴' },
    ])

    const result = await diagnoseStoryState(state, '/tmp/test')
    expect(result.outlineIssues).toContain(
      '第2章 "真假美猴王" 包含终结性事件（如"伏法"），但第3章 "三界求援" 需要对该事件进行后续辨别/审判，存在逻辑冲突'
    )
  })

  it('does not flag non-conflicting chapters', async () => {
    const state = createMockState([
      { number: 1, title: '启程', description: '主角出发' },
      { number: 2, title: '遇敌', description: '遭遇敌人战斗' },
      { number: 3, title: '休整', description: '疗伤恢复' },
    ])

    const result = await diagnoseStoryState(state, '/tmp/test')
    const conflictIssues = result.outlineIssues.filter(i => i.includes('逻辑冲突'))
    expect(conflictIssues).toHaveLength(0)
  })

  it('detects "消灭" followed by "查明"', async () => {
    const state = createMockState([
      { number: 1, title: '决战', description: '敌人被消灭' },
      { number: 2, title: '调查', description: '查明真相' },
    ])

    const result = await diagnoseStoryState(state, '/tmp/test')
    expect(result.outlineIssues).toContain(
      '第1章 "决战" 包含终结性事件（如"消灭"），但第2章 "调查" 需要对该事件进行后续辨别/审判，存在逻辑冲突'
    )
  })
})
