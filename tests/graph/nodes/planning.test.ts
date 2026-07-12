import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { ModelProvider } from '../../../src/model/provider.js'
import { plan_chapter_with_override } from '../../../src/graph/nodes/planning.js'

const { plannerRun } = vi.hoisted(() => ({ plannerRun: vi.fn() }))

vi.mock('../../../src/graph/agent-factory.js', () => ({
  getChapterPlannerAgent: vi.fn(() => ({ run: plannerRun })),
}))

vi.mock('../../../src/graph/utils/chapter-context.js', () => ({
  buildChapterAgentContext: vi.fn().mockResolvedValue({}),
  mergeAgentState: vi.fn((base: Record<string, unknown>, override: Record<string, unknown>) => ({
    ...base,
    ...override,
  })),
}))

function createMockProvider(): ModelProvider {
  return { chat: vi.fn() }
}

function buildState(overrides: Partial<ReducedGraphState> = {}): ReducedGraphState {
  return {
    currentChapterIndex: 25,
    chapterSummaries: [],
    pendingIssues: [],
    verifiedConstraints: [],
    ...overrides,
  } as ReducedGraphState
}

describe('plan_chapter_with_override', () => {
  beforeEach(() => {
    plannerRun.mockReset()
  })

  it('normalizes every expected event to the authoritative current chapter index', async () => {
    plannerRun.mockResolvedValue({
      success: true,
      data: {
        chapterIndex: 26,
        sections: [],
        timeline: [],
        outlineCheck: [],
        expectedEvents: [
          {
            id: 'evt-fulfill',
            type: 'foreshadow-fulfill',
            foreshadowId: 'fs-due',
            chapterIndex: 26,
            source: 'chapter',
          },
        ],
        fulfilledForeshadowIds: ['fs-due'],
      },
    })

    const result = await plan_chapter_with_override(
      createMockProvider(),
      buildState(),
      '第26章：底稿'
    )

    expect(result.chapterPlan?.chapterIndex).toBe(25)
    expect(result.chapterPlan?.expectedEvents).toEqual([
      {
        id: 'evt-fulfill',
        type: 'foreshadow-fulfill',
        foreshadowId: 'fs-due',
        chapterIndex: 25,
        source: 'chapter',
      },
    ])
  })
})
