import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { ModelProvider } from '../../../src/model/provider.js'
import { plan_chapter_with_override } from '../../../src/graph/nodes/planning.js'
import { createEmptyStoryMemory } from '../../../src/story-memory/projector.js'

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
        foreshadowFulfillmentConflictIds: ['fs-model-supplied'],
      },
    })
    const memory = createEmptyStoryMemory()
    memory.foreshadows = {
      'fs-due': {
        id: 'fs-due',
        text: 'due',
        kind: 'plot',
        introducedIn: 1,
        expectedFulfillChapter: 26,
        fulfilledIn: null,
        resolutionPolicy: 'must_resolve',
        required: true,
        beatId: null,
      },
    }

    const result = await plan_chapter_with_override(
      createMockProvider(),
      buildState({ storyMemory: memory }),
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
    expect(result.chapterPlan).not.toHaveProperty('foreshadowFulfillmentConflictIds')
  })

  it('records canonical fulfillment conflicts before normalizing raw chapter indexes', async () => {
    plannerRun.mockResolvedValue({
      success: true,
      data: {
        chapterIndex: 25,
        sections: [],
        timeline: [],
        outlineCheck: [],
        expectedEvents: [
          {
            id: 'evt-alias',
            type: 'foreshadow-fulfill',
            foreshadowId: 'fs-alias',
            chapterIndex: 24,
            source: 'chapter',
          },
          {
            id: 'evt-root',
            type: 'foreshadow-fulfill',
            foreshadowId: 'fs-root',
            chapterIndex: 25,
            source: 'chapter',
          },
        ],
        fulfilledForeshadowIds: ['fs-alias', 'fs-root'],
      },
    })
    const memory = createEmptyStoryMemory()
    memory.foreshadows = {
      'fs-root': {
        id: 'fs-root',
        text: 'root',
        kind: 'plot',
        introducedIn: 1,
        expectedFulfillChapter: 26,
        fulfilledIn: null,
        resolutionPolicy: 'must_resolve',
        required: true,
        beatId: null,
      },
      'fs-alias': {
        id: 'fs-alias',
        text: 'alias',
        kind: 'plot',
        introducedIn: 2,
        expectedFulfillChapter: 26,
        fulfilledIn: null,
        resolutionPolicy: 'must_resolve',
        required: true,
        beatId: null,
        mergedInto: 'fs-root',
      },
    }

    const result = await plan_chapter_with_override(
      createMockProvider(),
      buildState({ storyMemory: memory }),
      '第26章：底稿'
    )

    expect(result.chapterPlan?.expectedEvents.map((event) => event.chapterIndex)).toEqual([25, 25])
    expect(result.chapterPlan?.foreshadowFulfillmentConflictIds).toEqual(['fs-root'])
  })

  it('retries once with structured feedback when planner output is invalid', async () => {
    plannerRun
      .mockResolvedValueOnce({
        success: false,
        error: 'expectedEvents[0] 格式错误：item-state.attribute must be a non-empty string',
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          sections: [],
          timeline: [],
          outlineCheck: [],
          expectedEvents: [],
        },
      })

    const result = await plan_chapter_with_override(
      createMockProvider(),
      buildState(),
      '第26章：底稿'
    )

    expect(plannerRun).toHaveBeenCalledTimes(2)
    expect(plannerRun.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            type: 'outline_invalid',
            severity: 'error',
            description: expect.stringContaining(
              'expectedEvents[0] 格式错误：item-state.attribute must be a non-empty string'
            ),
          }),
        ],
      })
    )
    const retryInput = plannerRun.mock.calls[1]?.[0] as { issues: { description: string }[] }
    expect(retryInput.issues[0]?.description).toContain('修复提示')
    expect(retryInput.issues[0]?.description).toContain('无名临时角色禁止出现在 expectedEvents 中')
    expect(result.chapterPlan?.expectedEvents).toEqual([])
  })

  it('stops after two invalid planner outputs', async () => {
    plannerRun.mockResolvedValue({
      success: false,
      error: 'expectedEvents[0] 格式错误：item-location.holderId is required',
    })

    await expect(
      plan_chapter_with_override(createMockProvider(), buildState(), '第26章：底稿')
    ).rejects.toThrow(
      '第 26 章规划失败：expectedEvents[0] 格式错误：item-location.holderId is required'
    )
    expect(plannerRun).toHaveBeenCalledTimes(2)
  })

  it('accepts an authoritative short location ID', async () => {
    plannerRun.mockResolvedValue({
      success: true,
      data: {
        sections: [],
        timeline: [],
        outlineCheck: [],
        expectedEvents: [
          {
            id: 'evt-location',
            type: 'character-location',
            characterId: 'character-main',
            locationId: 'l-1',
            chapterIndex: 25,
            source: 'chapter',
          },
        ],
      },
    })
    const input = buildState({
      characters: [
        {
          id: 'character-main',
          storyId: 'story-1',
          name: 'Character',
          aliases: [],
          isProtagonist: true,
          description: null,
          dialogueStyle: null,
          createdAt: 1,
        },
      ],
      storyState: {
        characterLocations: { 'character-main': 'l-1' },
        characterStatus: {},
        keyItemsLocation: {},
        keyItemsState: {},
        activePlots: [],
        revealedSecrets: [],
        pendingTasks: [],
        currentScene: '',
        storyTime: '',
      },
    })

    const result = await plan_chapter_with_override(createMockProvider(), input, 'outline')

    expect(result.chapterPlan?.expectedEvents[0]).toMatchObject({ locationId: 'l-1' })
    expect(plannerRun).toHaveBeenCalledTimes(1)
  })

  it('retries an unauthorized planned reference before drafting', async () => {
    plannerRun
      .mockResolvedValueOnce({
        success: true,
        data: {
          sections: [],
          timeline: [],
          outlineCheck: [],
          expectedEvents: [
            {
              id: 'evt-invalid',
              type: 'character-location',
              characterId: 'character-main',
              locationId: 'location-unknown',
              chapterIndex: 25,
              source: 'chapter',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { sections: [], timeline: [], outlineCheck: [], expectedEvents: [] },
      })

    const result = await plan_chapter_with_override(
      createMockProvider(),
      buildState({
        characters: [
          {
            id: 'character-main',
            storyId: 'story-1',
            name: 'Character',
            aliases: [],
            isProtagonist: true,
            description: null,
            dialogueStyle: null,
            createdAt: 1,
          },
        ],
      }),
      'outline'
    )

    expect(plannerRun).toHaveBeenCalledTimes(2)
    expect(result.chapterPlan?.expectedEvents).toEqual([])
    expect(plannerRun.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            ruleId: 'planning.event-authority',
            description: expect.stringContaining('expectedEvents[0].locationId'),
          }),
        ],
      })
    )
  })

  it('aborts after two unauthorized planned references', async () => {
    plannerRun.mockResolvedValue({
      success: true,
      data: {
        sections: [],
        timeline: [],
        outlineCheck: [],
        expectedEvents: [
          {
            id: 'evt-invalid',
            type: 'character-location',
            characterId: 'character-unknown',
            locationId: null,
            chapterIndex: 25,
            source: 'chapter',
          },
        ],
      },
    })

    await expect(
      plan_chapter_with_override(createMockProvider(), buildState(), 'outline')
    ).rejects.toThrow('expectedEvents[0].characterId 引用了未授权 ID character-unknown')
    expect(plannerRun).toHaveBeenCalledTimes(2)
  })
})
