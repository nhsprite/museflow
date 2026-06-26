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

describe('diagnoseStoryState outline density check', () => {
  it('flags chapter with too many plot points', async () => {
    const state = createMockState([
      { number: 1, title: 'First Chapter', description: '主角出发前往京城。途中遇到神秘旅人。得知古老预言。决定改变路线。遭遇伏击。获得关键线索。进入地下遗迹。' },
      { number: 2, title: 'Second Chapter', description: '继续探索。' },
    ])

    const result = await diagnoseStoryState(state, '/tmp/test')
    expect(result.outlineIssues.some(i => i.includes('信息密度过高'))).toBe(true)
  })

  it('does not flag sparse chapters', async () => {
    const state = createMockState([
      { number: 1, title: 'First Chapter', description: '主角出发。' },
      { number: 2, title: 'Second Chapter', description: '遭遇敌人。' },
    ])

    const result = await diagnoseStoryState(state, '/tmp/test')
    expect(result.outlineIssues.some(i => i.includes('信息密度过高'))).toBe(false)
  })
})
