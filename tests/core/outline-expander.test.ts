import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as contextJudge from '../../src/utils/context-judge.js'
import {
  expandOutlineForChapter,
  validateChapterTimeAnchor,
} from '../../src/core/outline-expander.js'
import { validateChapterPlanBudget } from '../../src/utils/chapter-planning.js'
import {
  createActPressureConstraint,
  createGenericVerifiedConstraint,
} from '../../src/utils/verified-constraints.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { ChapterPlan } from '../../src/agents/chapter-planner.js'
import type { ModelProvider } from '../../src/model/provider.js'
import { logger } from '../../src/utils/logger.js'
import { readChapterContent, writeOutlineContent } from '../../src/storage/filesystem/writer.js'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import type { ForeshadowMemory, StoryEvent } from '../../src/types/story-memory.js'

const testTempDir = join(tmpdir(), `museflow-outline-expander-${randomUUID().slice(0, 8)}`)

const { planChapterWithOverrideMock } = vi.hoisted(() => ({
  planChapterWithOverrideMock: vi.fn(),
}))

const mockChat = vi.fn(async (): Promise<string> => '')
const mockChatStructured = vi.fn()
const chapterOutlineRunMock = vi.fn()

function createMockProvider(): ModelProvider {
  return {
    chat: mockChat,
    chatStructured: mockChatStructured,
  }
}

vi.mock('../../src/graph/nodes/planning.js', () => ({
  plan_chapter_with_override: planChapterWithOverrideMock,
}))

vi.mock('../../src/graph/agent-factory.js', () => ({
  getChapterOutlineAgent: () => ({
    run: vi.fn(async (state: { chapterIndex?: number }) => chapterOutlineRunMock(state)),
  }),
}))

vi.mock('../../src/utils/context-judge.js', () => ({
  batchValidateTimeAnchors: vi.fn().mockResolvedValue([{ valid: true }]),
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  writeOutlineContent: vi.fn().mockResolvedValue(undefined),
  readChapterContent: vi.fn().mockResolvedValue(null),
}))

const storyArc = {
  totalChapters: 3,
  acts: [
    {
      index: 1,
      startChapter: 1,
      endChapter: 3,
      title: '第一幕',
      theme: '测试主题',
      function: '测试功能',
      mandatoryBeats: ['主角离开家乡'],
    },
  ],
  keyBeats: [],
}

const baseState: ReducedGraphState = {
  story: { id: 'story-1', title: 'Story', outputDir: testTempDir },
  idea: 'idea',
  genre: 'default',
  totalChapters: 3,
  world: null,
  characters: [],
  storyArc,
  outline: [
    { number: 1, title: '启程', description: '主角离开家乡。' },
    { number: 2, title: '遇敌', description: '主角遭遇敌人并暂时被困。' },
    { number: 3, title: '脱困', description: '主角脱困并反击。' },
  ],
  actProgress: { 1: { consumed: [], pending: ['主角离开家乡'] } },
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

function createCompleteChapterPlan(overrides: Partial<ChapterPlan> = {}): ChapterPlan {
  return {
    chapterIndex: 1,
    sections: [],
    timeline: [],
    outlineCheck: [],
    expectedEvents: [],
    claimedMandatoryBeatIds: [],
    claimedBeatIds: [],
    fulfilledForeshadowIds: [],
    introducedForeshadowIds: [],
    resolvedTaskIds: [],
    createdTaskIds: [],
    ...overrides,
  }
}

function createForeshadowFulfillEvent(foreshadowId: string, chapterIndex: number): StoryEvent {
  return {
    id: `event-${foreshadowId}`,
    type: 'foreshadow-fulfill',
    chapterIndex,
    source: 'outline',
    foreshadowId,
  }
}

function createRequiredForeshadow(
  id: string,
  expectedFulfillChapter: number | null,
  introducedIn = 0
): ForeshadowMemory {
  return {
    id,
    text: `structured clue ${id}`,
    kind: 'plot',
    introducedIn,
    expectedFulfillChapter,
    fulfilledIn: null,
    required: true,
    beatId: null,
  }
}

function stateWithScheduledForeshadows(
  chapterIndex: number,
  description: string,
  foreshadows: ForeshadowMemory[]
): ReducedGraphState {
  return {
    ...baseState,
    currentChapterIndex: chapterIndex,
    totalChapters: 4,
    story: { ...baseState.story, totalChapters: 4 },
    storyArc: {
      totalChapters: 4,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 3,
          title: '第一幕',
          theme: '建立',
          function: '推进',
          mandatoryBeats: [],
        },
        {
          index: 2,
          startChapter: 4,
          endChapter: 4,
          title: '第二幕',
          theme: '收束',
          function: '结束',
          mandatoryBeats: [],
        },
      ],
      keyBeats: [],
    },
    outline: [
      { number: 1, title: '第一章', description: '第一章既有大纲。' },
      { number: 2, title: '第二章', description: chapterIndex === 1 ? description : '第二章。' },
      { number: 3, title: '第三章', description: chapterIndex === 2 ? description : '第三章。' },
      { number: 4, title: '第四章', description: chapterIndex === 3 ? description : '第四章。' },
    ],
    actProgress: {
      1: { consumed: [], pending: [] },
      2: { consumed: [], pending: [] },
    },
    chapters: [null, null, null, null],
    storyMemory: {
      ...createEmptyStoryMemory(),
      foreshadows: Object.fromEntries(foreshadows.map((foreshadow) => [foreshadow.id, foreshadow])),
    },
  }
}

describe('expandOutlineForChapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: { sections: [] } })
    mockChatStructured.mockResolvedValue({ results: [true, true] })
    mockChat.mockResolvedValue(JSON.stringify({ results: [true, true] }))
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '即时标题',
        description: '即时生成的描述。',
        introducedCharacters: [],
        claimedBeats: [],
      },
    })
  })

  it('calls plan_chapter with current and next chapter arcs when descriptions exist', async () => {
    await expandOutlineForChapter(baseState, 1, createMockProvider())

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    expect(chapterOutlineRunMock).not.toHaveBeenCalled()
    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
    expect(formattedOutline).toContain('第2章：遇敌')
    expect(formattedOutline).toContain('主角遭遇敌人并暂时被困')
  })

  it('generates JIT outline when description is empty', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '脱困', description: '主角脱困并反击。' },
      ],
    }

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    expect(result.outline?.[1]?.title).toBe('即时标题')
    expect(result.outline?.[1]?.description).toBe('即时生成的描述。')
    expect(writeOutlineContent).not.toHaveBeenCalled()
  })

  it('keeps planner fulfillment evidence when it covers the outline claim', async () => {
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [
      createRequiredForeshadow('fs-due', 2),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 1 ? { ...item, fulfilledForeshadowIds: ['fs-due'] } : item
      ),
    }
    const stalePlan = createCompleteChapterPlan({
      chapterIndex: 0,
      fulfilledForeshadowIds: ['fs-due'],
      expectedEvents: [createForeshadowFulfillEvent('fs-due', 0)],
    })
    const requestedPlan = createCompleteChapterPlan({
      chapterIndex: 0,
      fulfilledForeshadowIds: ['fs-due'],
      expectedEvents: [
        createForeshadowFulfillEvent('fs-due', 0),
        createForeshadowFulfillEvent('fs-due', 1),
      ],
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({ chapterPlan: requestedPlan })

    const result = await expandOutlineForChapter(
      { ...state, chapterPlan: stalePlan },
      1,
      createMockProvider()
    )

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    expect(result.chapterPlan.chapterIndex).toBe(1)
    expect(result.chapterPlan.fulfilledForeshadowIds).toEqual(['fs-due'])
    expect(result.chapterPlan.expectedEvents).toEqual(requestedPlan.expectedEvents)
  })

  it('preserves legacy plan fulfillment evidence when story memory is null', async () => {
    const legacyPlan = createCompleteChapterPlan({
      chapterIndex: 1,
      fulfilledForeshadowIds: ['legacy-foreshadow'],
      expectedEvents: [createForeshadowFulfillEvent('legacy-foreshadow', 1)],
    })

    const result = await expandOutlineForChapter(
      { ...baseState, storyMemory: null, chapterPlan: legacyPlan },
      1,
      createMockProvider()
    )

    expect(planChapterWithOverrideMock).not.toHaveBeenCalled()
    expect(result.chapterPlan.fulfilledForeshadowIds).toEqual(['legacy-foreshadow'])
    expect(result.chapterPlan.expectedEvents).toEqual([
      createForeshadowFulfillEvent('legacy-foreshadow', 1),
    ])
  })

  it('replans a resumed chapter whose legacy event cannot be normalized safely', async () => {
    const legacyPlan = createCompleteChapterPlan({
      chapterIndex: 1,
      expectedEvents: [
        {
          id: 'evt-legacy-state',
          type: 'item-state',
          itemId: 'item-1',
          state: 'closed',
          chapterIndex: 1,
          source: 'chapter',
        } as unknown as StoryEvent,
      ],
    })
    const replacementPlan = createCompleteChapterPlan({
      chapterIndex: 1,
      expectedEvents: [
        {
          id: 'evt-replacement-state',
          type: 'item-state',
          itemId: 'item-1',
          attribute: 'sealed',
          value: true,
          chapterIndex: 1,
          source: 'chapter',
        },
      ],
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({ chapterPlan: replacementPlan })

    const result = await expandOutlineForChapter(
      { ...baseState, storyMemory: null, chapterPlan: legacyPlan },
      1,
      createMockProvider()
    )

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    expect(result.chapterPlan).toEqual(replacementPlan)
  })

  it('schedules a due foreshadow on an ordinary non-boundary chapter', async () => {
    const state = stateWithScheduledForeshadows(1, '', [createRequiredForeshadow('fs-due', 2)])
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '回收线索',
        description: '在核心事件内回收既有线索。',
        fulfilledForeshadowIds: ['fs-due'],
      },
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 1,
        fulfilledForeshadowIds: ['fs-due'],
        expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
      }),
    })

    const result = await expandOutlineForChapter(state, 1, createMockProvider())

    expect(result.outline?.[1]?.fulfilledForeshadowIds).toEqual(['fs-due'])
    expect(result.outline?.[1]?.deferredForeshadowIds).toEqual([])
    const jitInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      verifiedConstraints?: string[]
    }
    expect(jitInput.verifiedConstraints?.join('\n')).toContain('fs-due')
  })

  it('passes without retry when every scheduled candidate is adjudicated', async () => {
    const state = stateWithScheduledForeshadows(1, '', [
      createRequiredForeshadow('fs-a', 2),
      createRequiredForeshadow('fs-b', 2),
    ])
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '部分回收',
        description: '本章自然回收其中一条线索，另一条与本章核心事件不相容，顺延处理。',
        fulfilledForeshadowIds: ['fs-a'],
        deferredForeshadowIds: ['fs-b'],
      },
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 1,
        fulfilledForeshadowIds: ['fs-a'],
        expectedEvents: [createForeshadowFulfillEvent('fs-a', 1)],
      }),
    })

    const result = await expandOutlineForChapter(state, 1, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    expect(result.outline?.[1]?.fulfilledForeshadowIds).toEqual(['fs-a'])
    expect(result.outline?.[1]?.deferredForeshadowIds).toEqual(['fs-b'])
    expect(result.chapterPlan.fulfilledForeshadowIds).toEqual(['fs-a'])
    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(1)
    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
    expect(formattedOutline).toContain('【本章伏笔调度候选】fs-a, fs-b')
    expect(formattedOutline).toContain('【本章兑现伏笔】fs-a')
    expect(formattedOutline).toContain('【本章顺延伏笔】fs-b')
  })

  it('retries JIT outline generation when a scheduled obligation is omitted', async () => {
    chapterOutlineRunMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '遗漏版本',
          description: '没有安排伏笔回收。',
          fulfilledForeshadowIds: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          title: '修正版',
          description: '在核心事件内完成既有线索回收。',
          fulfilledForeshadowIds: ['fs-due'],
        },
      })
    planChapterWithOverrideMock.mockResolvedValue({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 2,
        fulfilledForeshadowIds: ['fs-due'],
        expectedEvents: [createForeshadowFulfillEvent('fs-due', 2)],
      }),
    })

    const result = await expandOutlineForChapter(
      stateWithScheduledForeshadows(2, '', [createRequiredForeshadow('fs-due', 3)]),
      2,
      createMockProvider()
    )

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(2)
    expect(result.outline?.[2]?.fulfilledForeshadowIds).toEqual(['fs-due'])
    const retryInput = chapterOutlineRunMock.mock.calls[1]![0] as {
      verifiedConstraints?: string[]
    }
    expect(retryInput.verifiedConstraints?.join('\n')).toContain('fs-due')
  })

  it('passes bounded scheduled IDs to planning when an outline already exists', async () => {
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [
      createRequiredForeshadow('fs-a', 2),
      createRequiredForeshadow('fs-b', 2),
      createRequiredForeshadow('fs-c', 2),
      createRequiredForeshadow('fs-d', 2),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 1 ? { ...item, fulfilledForeshadowIds: ['fs-d'] } : item
      ),
    }
    planChapterWithOverrideMock.mockResolvedValue({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 1,
        fulfilledForeshadowIds: ['fs-d'],
        expectedEvents: [createForeshadowFulfillEvent('fs-d', 1)],
      }),
    })

    await expandOutlineForChapter(state, 1, createMockProvider())

    expect(chapterOutlineRunMock).not.toHaveBeenCalled()
    const planState = planChapterWithOverrideMock.mock.calls[0]![1] as ReducedGraphState
    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
    expect(formattedOutline).toContain('【本章伏笔调度候选】fs-a, fs-b, fs-c')
    expect(formattedOutline).toContain('【本章兑现伏笔】fs-d')
    expect(planState.verifiedConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'generic',
          text: expect.stringContaining('fs-a'),
        }),
      ])
    )
  })

  it('excludes unscheduled clues in an ordinary act and includes future/null clues in the final act', async () => {
    const ordinaryState = stateWithScheduledForeshadows(1, '既有大纲。', [
      createRequiredForeshadow('fs-due', 2),
      createRequiredForeshadow('fs-future', 4),
      createRequiredForeshadow('fs-null', null),
    ])
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 1,
        fulfilledForeshadowIds: ['fs-due'],
        expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
      }),
    })

    await expandOutlineForChapter(ordinaryState, 1, createMockProvider())

    const ordinaryOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
    expect(ordinaryOutline).toContain('fs-due')
    expect(ordinaryOutline).not.toContain('fs-future')
    expect(ordinaryOutline).not.toContain('fs-null')

    const finalActState = stateWithScheduledForeshadows(3, '终幕既有大纲。', [
      createRequiredForeshadow('fs-future', 6),
      createRequiredForeshadow('fs-null', null),
    ])
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 3,
        fulfilledForeshadowIds: ['fs-future', 'fs-null'],
        expectedEvents: ['fs-future', 'fs-null'].map((id) => createForeshadowFulfillEvent(id, 3)),
      }),
    })

    await expandOutlineForChapter(finalActState, 3, createMockProvider())

    const finalOutline = planChapterWithOverrideMock.mock.calls[1]![2] as string
    expect(finalOutline).toContain('fs-future')
    expect(finalOutline).toContain('fs-null')
  })

  it('throws the exact bounded scheduling error after all JIT attempts omit a selected ID', async () => {
    const state = stateWithScheduledForeshadows(1, '', [createRequiredForeshadow('fs-due', 2)])
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '遗漏版本',
        description: '没有声明线索回收。',
        fulfilledForeshadowIds: [],
      },
    })

    try {
      await expect(expandOutlineForChapter(state, 1, createMockProvider())).rejects.toThrow(
        '第 2 章即时大纲连续 3 次存在未裁决伏笔候选：fs-due（单章容量 3）'
      )
      expect(chapterOutlineRunMock).toHaveBeenCalledTimes(3)
      expect(warnSpy).toHaveBeenCalledWith(
        '[MuseFlow] 第 2 章即时大纲第 1/3 次存在未裁决伏笔候选：fs-due'
      )
      expect(warnSpy).toHaveBeenCalledWith(
        '[MuseFlow] 第 2 章即时大纲第 3/3 次存在未裁决伏笔候选：fs-due'
      )
      expect(planChapterWithOverrideMock).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('replans when a declaration is present but its expected event is missing', async () => {
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [
      createRequiredForeshadow('fs-due', 2),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 1 ? { ...item, fulfilledForeshadowIds: ['fs-due'] } : item
      ),
    }
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    try {
      planChapterWithOverrideMock
        .mockResolvedValueOnce({
          chapterPlan: createCompleteChapterPlan({
            chapterIndex: 1,
            fulfilledForeshadowIds: ['fs-due'],
          }),
        })
        .mockResolvedValueOnce({
          chapterPlan: createCompleteChapterPlan({
            chapterIndex: 1,
            fulfilledForeshadowIds: ['fs-due'],
            expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
          }),
        })

      const result = await expandOutlineForChapter(state, 1, createMockProvider())

      expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(2)
      expect(result.chapterPlan.expectedEvents).toEqual([createForeshadowFulfillEvent('fs-due', 1)])
      expect(warnSpy).toHaveBeenCalledWith(
        '[MuseFlow] 第 2 章章节规划第 1/2 次遗漏大纲声称的伏笔兑现证据：fulfilledForeshadowIds：（无遗漏）；expectedEvents.foreshadow-fulfill：fs-due（单章容量 3）'
      )
      const correctionState = planChapterWithOverrideMock.mock.calls[1]![1] as ReducedGraphState
      const correctionText = correctionState.verifiedConstraints
        ?.map((item) => item.text)
        .join('\n')
      expect(correctionText).toContain('expectedEvents')
      expect(correctionText).toContain('fs-due')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('reports exact evidence and capacity after the initial plan correction is exhausted', async () => {
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [
      createRequiredForeshadow('fs-due', 2),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 1 ? { ...item, fulfilledForeshadowIds: ['fs-due'] } : item
      ),
    }
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    planChapterWithOverrideMock
      .mockResolvedValueOnce({
        chapterPlan: createCompleteChapterPlan({
          chapterIndex: 1,
          fulfilledForeshadowIds: ['fs-due'],
        }),
      })
      .mockResolvedValueOnce({
        chapterPlan: createCompleteChapterPlan({
          chapterIndex: 1,
          expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
        }),
      })

    try {
      await expect(expandOutlineForChapter(state, 1, createMockProvider())).rejects.toThrow(
        '第 2 章章节规划连续 2 次遗漏大纲声称的伏笔兑现证据：fulfilledForeshadowIds：fs-due；expectedEvents.foreshadow-fulfill：（无遗漏）（单章容量 3）'
      )
      expect(warnSpy).toHaveBeenCalledWith(
        '[MuseFlow] 第 2 章章节规划第 2/2 次遗漏大纲声称的伏笔兑现证据：fulfilledForeshadowIds：fs-due；expectedEvents.foreshadow-fulfill：（无遗漏）（单章容量 3）'
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('extends a boundary by three chapters for eleven due IDs and schedules only the first three', async () => {
    const foreshadowIds = Array.from(
      { length: 11 },
      (_, index) => `fs-${String(index + 1).padStart(2, '0')}`
    )
    const state = stateWithScheduledForeshadows(
      2,
      '',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 3))
    )
    const scheduledIds = foreshadowIds.slice(0, 3)
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '批次回收',
        description: '本章完成容量内的第一批线索回收。',
        fulfilledForeshadowIds: [...scheduledIds, foreshadowIds[3]!],
      },
    })
    planChapterWithOverrideMock.mockResolvedValueOnce({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 2,
        fulfilledForeshadowIds: [...scheduledIds, foreshadowIds[3]!],
        expectedEvents: [...scheduledIds, foreshadowIds[3]!].map((id) =>
          createForeshadowFulfillEvent(id, 2)
        ),
      }),
    })

    const result = await expandOutlineForChapter(state, 2, createMockProvider())

    expect(result.storyArc?.acts.map((act) => [act.startChapter, act.endChapter])).toEqual([
      [1, 6],
      [7, 7],
    ])
    expect(result.totalChapters).toBe(7)
    expect(result.story?.totalChapters).toBe(7)
    expect(result.outline).toHaveLength(7)
    expect(result.outline?.[2]?.fulfilledForeshadowIds).toEqual([
      ...scheduledIds,
      foreshadowIds[3]!,
    ])
    expect(result.chapterPlan.fulfilledForeshadowIds).toEqual([...scheduledIds, foreshadowIds[3]!])
    expect(
      result.chapterPlan.expectedEvents
        .filter((event) => event.type === 'foreshadow-fulfill')
        .map((event) => event.foreshadowId)
    ).toEqual([...scheduledIds, foreshadowIds[3]!])
    const jitInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      verifiedConstraints?: string[]
    }
    const jitConstraints = jitInput.verifiedConstraints?.join('\n') ?? ''
    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
    for (const id of scheduledIds) expect(jitConstraints).toContain(id)
    for (const id of [...scheduledIds, foreshadowIds[3]!]) expect(formattedOutline).toContain(id)
    for (const id of foreshadowIds.slice(3)) {
      expect(jitConstraints).not.toContain(id)
    }
    for (const id of foreshadowIds.slice(4)) {
      expect(formattedOutline).not.toContain(id)
    }
  })

  it('does not persist a staged capacity extension when JIT outline retries are exhausted', async () => {
    const foreshadowIds = Array.from(
      { length: 11 },
      (_, index) => `fs-${String(index + 1).padStart(2, '0')}`
    )
    const state = stateWithScheduledForeshadows(
      2,
      '',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 3))
    )
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '遗漏版本',
        description: '未声明调度批次。',
        fulfilledForeshadowIds: [],
      },
    })

    await expect(expandOutlineForChapter(state, 2, createMockProvider())).rejects.toThrow(
      '第 3 章即时大纲连续 3 次存在未裁决伏笔候选：fs-01, fs-02, fs-03（单章容量 3）'
    )
    expect(writeOutlineContent).not.toHaveBeenCalled()
  })

  it('does not persist staged extension or JIT outline when plan correction is exhausted', async () => {
    const foreshadowIds = Array.from(
      { length: 11 },
      (_, index) => `fs-${String(index + 1).padStart(2, '0')}`
    )
    const state = stateWithScheduledForeshadows(
      2,
      '',
      foreshadowIds.map((id) => createRequiredForeshadow(id, 3))
    )
    const scheduledIds = foreshadowIds.slice(0, 3)
    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '已调度大纲',
        description: '声明本章调度批次。',
        fulfilledForeshadowIds: scheduledIds,
      },
    })
    planChapterWithOverrideMock.mockResolvedValue({
      chapterPlan: createCompleteChapterPlan({
        chapterIndex: 2,
        fulfilledForeshadowIds: scheduledIds,
      }),
    })

    await expect(expandOutlineForChapter(state, 2, createMockProvider())).rejects.toThrow(
      '第 3 章章节规划连续 2 次遗漏大纲声称的伏笔兑现证据：fulfilledForeshadowIds：（无遗漏）；expectedEvents.foreshadow-fulfill：fs-01, fs-02, fs-03（单章容量 3）'
    )
    expect(writeOutlineContent).not.toHaveBeenCalled()
  })

  it('rejects a time-anchor replan that drops a scheduled fulfillment event', async () => {
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [
      createRequiredForeshadow('fs-due', 2),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 1 ? { ...item, fulfilledForeshadowIds: ['fs-due'] } : item
      ),
    }
    const initiallyValidEvidence = createCompleteChapterPlan({
      chapterIndex: 1,
      fulfilledForeshadowIds: ['fs-due'],
      expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
      chapterTimeAnchor: '错误承接',
    })
    const droppedEvent = createCompleteChapterPlan({
      chapterIndex: 1,
      fulfilledForeshadowIds: ['fs-due'],
      chapterTimeAnchor: '修正承接',
    })
    planChapterWithOverrideMock
      .mockResolvedValueOnce({ chapterPlan: initiallyValidEvidence })
      .mockResolvedValueOnce({ chapterPlan: droppedEvent })
    vi.mocked(readChapterContent).mockResolvedValueOnce('上一章正文。')
    vi.mocked(contextJudge.batchValidateTimeAnchors).mockResolvedValueOnce([
      { valid: false, reason: '时间锚点不一致' },
    ])

    await expect(expandOutlineForChapter(state, 1, createMockProvider())).rejects.toThrow(
      '第 2 章时间锚点重规划遗漏大纲声称的伏笔兑现证据：fulfilledForeshadowIds：（无遗漏）；expectedEvents.foreshadow-fulfill：fs-due（单章容量 3）'
    )
  })

  it('rejects a budget replan that drops a scheduled declaration', async () => {
    const scheduledState = stateWithScheduledForeshadows(1, '既有大纲。', [
      createRequiredForeshadow('fs-due', 2),
    ])
    const state: ReducedGraphState = {
      ...scheduledState,
      outline: scheduledState.outline.map((item, index) =>
        index === 1 ? { ...item, fulfilledForeshadowIds: ['fs-due'] } : item
      ),
    }
    const sections: ChapterPlan['sections'] = [
      {
        title: '核心事件',
        summary: '推进核心事件',
        wordCount: 1000,
        events: ['核心事件'],
        characters: ['主角'],
        timeMark: '当前',
      },
      {
        title: '偏离事件',
        summary: '偏离大纲重心',
        wordCount: 2000,
        events: ['偏离事件'],
        characters: ['主角'],
        timeMark: '稍后',
      },
    ]
    const initiallyValidEvidence = createCompleteChapterPlan({
      chapterIndex: 1,
      sections,
      outlineCheck: [{ requirement: '核心事件', fulfilled: true, section: '核心事件' }],
      fulfilledForeshadowIds: ['fs-due'],
      expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
    })
    const droppedDeclaration = createCompleteChapterPlan({
      chapterIndex: 1,
      sections,
      outlineCheck: [{ requirement: '核心事件', fulfilled: true, section: '核心事件' }],
      expectedEvents: [createForeshadowFulfillEvent('fs-due', 1)],
    })
    planChapterWithOverrideMock
      .mockResolvedValueOnce({ chapterPlan: initiallyValidEvidence })
      .mockResolvedValueOnce({ chapterPlan: droppedDeclaration })
    mockChatStructured.mockResolvedValue({ results: [true, false] })

    await expect(expandOutlineForChapter(state, 1, createMockProvider())).rejects.toThrow(
      '第 2 章预算重规划遗漏大纲声称的伏笔兑现证据：fulfilledForeshadowIds：fs-due；expectedEvents.foreshadow-fulfill：（无遗漏）（单章容量 3）'
    )
  })

  it('passes the previous chapter ending into JIT outline generation', async () => {
    vi.mocked(readChapterContent).mockResolvedValue(
      '上一章最后，主角已经离开医务室，沿走廊继续朝七班教室方向走。'
    )
    const jitState: ReducedGraphState = {
      ...baseState,
      outline: [
        { number: 1, title: '启程', description: '主角离开家乡。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '脱困', description: '主角脱困并反击。' },
      ],
    }

    await expandOutlineForChapter(jitState, 1, createMockProvider())

    const agentInput = chapterOutlineRunMock.mock.calls[0]![0] as { previousChapters?: string }
    expect(agentInput.previousChapters).toContain('上一章结尾片段')
    expect(agentInput.previousChapters).toContain('继续朝七班教室方向走')
  })

  it('filters stale act-pressure constraints before generating a JIT outline', async () => {
    const staleActPressure = createActPressureConstraint(
      1,
      '第 1 幕「旧幕」还剩 1 章结束，必须优先消费以下 mandatory beats：旧幕节拍。'
    )
    const currentActPressure = createActPressureConstraint(
      2,
      '第 2 幕「新幕」还剩 2 章结束，必须优先消费以下 mandatory beats：新幕节拍。'
    )
    const durableConstraint =
      createGenericVerifiedConstraint('【伏笔边界】不要提前揭示尚未到期的伏笔。')
    const jitState: ReducedGraphState = {
      ...baseState,
      storyArc: {
        totalChapters: 3,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '旧幕',
            theme: '收束',
            function: '收束旧目标',
            mandatoryBeats: ['旧幕节拍'],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 3,
            title: '新幕',
            theme: '转折',
            function: '推进新目标',
            mandatoryBeats: ['新幕节拍'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        { number: 1, title: '旧幕收束', description: '旧幕节拍已完成。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '新幕继续', description: '新幕继续推进。' },
      ],
      actProgress: {
        1: { consumed: ['旧幕节拍'], pending: [] },
        2: { consumed: [], pending: ['新幕节拍'] },
      },
      verifiedConstraints: [staleActPressure, durableConstraint, currentActPressure],
    }

    await expandOutlineForChapter(jitState, 1, createMockProvider())

    const agentInput = chapterOutlineRunMock.mock.calls[0]![0] as { verifiedConstraints?: string[] }
    expect(agentInput.verifiedConstraints).toEqual([
      durableConstraint.text,
      currentActPressure.text,
      '【节拍预算】本章属于第 2 幕，剩余 1 个 mandatory beats、1 章未写。本章 description 与 claimedBeats 最多承载 1 个 mandatory beat，严禁在本章内一次性推进本幕其余所有节拍。',
    ])
  })

  it('keeps exact current-act claimed beats without description support matching', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      totalChapters: 3,
      story: { ...baseState.story, totalChapters: 3 },
      currentChapterIndex: 1,
      storyArc: {
        totalChapters: 3,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '上一幕',
            theme: '收束',
            function: '处理上一幕尾声',
            mandatoryBeats: [],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 3,
            title: '新幕',
            theme: '裂变',
            function: '外部势力干扰核心安排，主角危机浮现',
            mandatoryBeats: ['外部势力干扰核心安排'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        { number: 1, title: '旧幕收束', description: '旧幕收束。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '', description: '' },
      ],
      actProgress: {
        2: { consumed: [], pending: ['外部势力干扰核心安排'] },
      },
      chapters: [null, null, null],
    }

    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '常规赴约',
        description: '主角午后赴约，得知常规规矩，归处后等待同伴回报。',
        introducedCharacters: [],
        claimedBeats: ['外部势力干扰核心安排', '非当前幕节拍'],
      },
    })

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    expect(result.outline?.[1]?.title).toBe('常规赴约')
    expect(result.outline?.[1]?.claimedBeats).toEqual(['外部势力干扰核心安排'])
  })

  it('caps claimed beats to the beat budget when agent over-claims', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      totalChapters: 5,
      story: { ...baseState.story, totalChapters: 5 },
      currentChapterIndex: 1,
      storyArc: {
        totalChapters: 5,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '上一幕',
            theme: '收束',
            function: '处理上一幕尾声',
            mandatoryBeats: [],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 5,
            title: '新幕',
            theme: '裂变',
            function: '外部势力干扰核心安排，主角危机浮现',
            mandatoryBeats: ['beat1', 'beat2', 'beat3'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        { number: 1, title: '旧幕收束', description: '旧幕收束。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '', description: '' },
        { number: 4, title: '', description: '' },
        { number: 5, title: '', description: '' },
      ],
      actProgress: {
        2: { consumed: [], pending: ['beat1', 'beat2', 'beat3'] },
      },
      chapters: [null, null, null, null, null],
    }

    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '过度承载',
        description: '主角同时遭遇外部压力、获得盟友、并发现真相。',
        introducedCharacters: [],
        claimedBeats: ['beat1', 'beat2', 'beat3'],
      },
    })

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    // Chapter 2 of act 2 (3 pending, 4 remaining chapters) -> budget = ceil(0.75 * 1.5) = 2
    expect(result.outline?.[1]?.claimedBeats).toHaveLength(2)
    expect(result.outline?.[1]?.claimedBeats).toEqual(['beat1', 'beat2'])
  })

  it('keeps claimedBeatIds paired with claimedBeats when filtering and capping', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      totalChapters: 3,
      story: { ...baseState.story, totalChapters: 3 },
      currentChapterIndex: 1,
      storyArc: {
        totalChapters: 3,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '上一幕',
            theme: '收束',
            function: '处理上一幕尾声',
            mandatoryBeats: ['opening'],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 3,
            title: '新幕',
            theme: '裂变',
            function: '外部势力干扰核心安排，主角危机浮现',
            mandatoryBeats: ['beat1', 'beat2'],
          },
        ],
        keyBeats: [
          { id: 'future-id', beat: 'futureBeat', deadlineAct: 3, required: true },
          { id: 'beat1-id', beat: 'beat1', deadlineAct: 2, required: true },
          { id: 'beat2-id', beat: 'beat2', deadlineAct: 2, required: true },
        ],
      },
      outline: [
        { number: 1, title: '旧幕收束', description: '旧幕收束。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '', description: '' },
      ],
      actProgress: {
        1: { consumed: ['opening'], pending: [] },
        2: { consumed: [], pending: ['beat1', 'beat2'] },
      },
      chapters: [null, null, null],
    }

    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '配对测试',
        description: '本章推进 beat1 与 beat2，同时误报未来节拍。',
        introducedCharacters: [],
        claimedBeats: ['futureBeat', 'beat1', 'beat2'],
        claimedBeatIds: ['future-id', 'beat1-id', 'beat2-id'],
      },
    })

    const result = await expandOutlineForChapter(jitState, 1, createMockProvider())

    expect(result.outline?.[1]?.claimedBeats).toEqual(['beat1', 'beat2'])
    expect(result.outline?.[1]?.claimedBeatIds).toEqual(['beat1-id', 'beat2-id'])
  })

  it('throws JIT outline conflicts without parsing conflictReason text for retries', async () => {
    const jitState: ReducedGraphState = {
      ...baseState,
      totalChapters: 4,
      story: { ...baseState.story, totalChapters: 4 },
      currentChapterIndex: 1,
      storyArc: {
        totalChapters: 4,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '上一幕',
            theme: '收束',
            function: '处理上一幕尾声',
            mandatoryBeats: [],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 4,
            title: '新幕',
            theme: '转折',
            function: '外部压力打破既定安排',
            mandatoryBeats: ['外部压力打破既定安排'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        { number: 1, title: '旧幕收束', description: '旧幕收束。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '', description: '' },
        { number: 4, title: '', description: '' },
      ],
      actProgress: {
        2: { consumed: [], pending: ['外部压力打破既定安排'] },
      },
      chapters: [null, null, null, null],
    }

    chapterOutlineRunMock.mockResolvedValueOnce({
      success: true,
      data: {
        title: '冲突',
        description: '主角继续原有安排。',
        introducedCharacters: [],
        claimedBeats: ['外部压力打破既定安排'],
        conflict: true,
        conflictReason:
          "本描述将 '外部压力打破既定安排' 列为 claimedBeat，但 description 未承载对应事件，属于强行贴标签。",
      },
    })

    await expect(expandOutlineForChapter(jitState, 1, createMockProvider())).rejects.toThrow(
      '即时大纲与权威事实冲突'
    )
    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
  })

  it('extends an overloaded current act before generating a JIT outline', async () => {
    const overloadedState: ReducedGraphState = {
      ...baseState,
      totalChapters: 6,
      story: { ...baseState.story, totalChapters: 6 },
      currentChapterIndex: 1,
      storyArc: {
        totalChapters: 6,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '第一幕',
            theme: '建立',
            function: '开篇',
            mandatoryBeats: ['开篇'],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 2,
            title: '第二幕',
            theme: '对抗',
            function: '升级冲突',
            mandatoryBeats: ['beat1', 'beat2', 'beat3', 'beat4'],
          },
          {
            index: 3,
            startChapter: 3,
            endChapter: 6,
            title: '第三幕',
            theme: '收束',
            function: '解决',
            mandatoryBeats: ['beat5'],
          },
        ],
        keyBeats: [],
      },
      outline: [
        { number: 1, title: '启程', description: '开篇。' },
        { number: 2, title: '', description: '' },
        { number: 3, title: '', description: '' },
        { number: 4, title: '', description: '' },
        { number: 5, title: '', description: '' },
        { number: 6, title: '', description: '' },
      ],
      actProgress: {
        2: { consumed: [], pending: ['beat1', 'beat2', 'beat3', 'beat4'] },
      },
      chapters: [null, null, null, null, null, null],
    }

    const result = await expandOutlineForChapter(overloadedState, 1, createMockProvider())

    const agentInput = chapterOutlineRunMock.mock.calls[0]![0] as {
      storyArc: typeof overloadedState.storyArc
      totalChapters: number
    }
    expect(agentInput.storyArc.acts.map((act) => [act.startChapter, act.endChapter])).toEqual([
      [1, 1],
      [2, 4],
      [5, 8],
    ])
    expect(agentInput.totalChapters).toBe(8)
    expect(result.storyArc?.totalChapters).toBe(8)
    expect(result.outline).toHaveLength(8)
  })

  it('stops before outline generation when pre-outline act extension needs manual adjustment', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const overloadedState: ReducedGraphState = {
      ...baseState,
      totalChapters: 46,
      story: { ...baseState.story, totalChapters: 46 },
      currentChapterIndex: 1,
      storyArc: {
        totalChapters: 46,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '第一幕',
            theme: '建立',
            function: '开篇',
            mandatoryBeats: [],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 2,
            title: '第二幕',
            theme: '对抗',
            function: '升级冲突',
            mandatoryBeats: ['beat1', 'beat2', 'beat3', 'beat4'],
          },
        ],
        keyBeats: [],
        autoBoundaryAdjustment: {
          originalTotalChapters: 40,
          totalExtendedChapters: 6,
        },
      },
      outline: [
        { number: 1, title: '启程', description: '开篇。' },
        { number: 2, title: '', description: '' },
      ],
      actProgress: {
        2: { consumed: [], pending: ['beat1', 'beat2', 'beat3', 'beat4'] },
      },
      chapters: [null, null],
    }

    try {
      await expect(
        expandOutlineForChapter(overloadedState, 1, createMockProvider())
      ).rejects.toThrow('museflow adjust-act story-1 --act 2 --end-chapter 4')

      expect(warnSpy).toHaveBeenCalledWith(
        '[MuseFlow] 建议运行：museflow adjust-act story-1 --act 2 --end-chapter 4'
      )
      expect(chapterOutlineRunMock).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('includes next-act boundary hint when next chapter enters new act', async () => {
    const multiActState: ReducedGraphState = {
      ...baseState,
      storyArc: {
        totalChapters: 3,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 1,
            title: '第一幕',
            theme: '启程',
            function: '出发',
            mandatoryBeats: [],
          },
          {
            index: 2,
            startChapter: 2,
            endChapter: 3,
            title: '第二幕',
            theme: '冲突',
            function: '对抗',
            mandatoryBeats: [],
          },
        ],
        keyBeats: [],
      },
    }

    await expandOutlineForChapter(multiActState, 0, createMockProvider())

    const formattedOutline = planChapterWithOverrideMock.mock.calls[0]![2] as string
    expect(formattedOutline).toContain('后续幕边界提示')
  })

  it('returns boundary hints', async () => {
    const result = await expandOutlineForChapter(baseState, 1, createMockProvider())

    expect(result.boundaryHints.length).toBeGreaterThan(0)
    expect(result.chapterPlan).toBeDefined()
  })

  it('throws when plan_chapter returns no plan', async () => {
    planChapterWithOverrideMock.mockResolvedValueOnce({})
    await expect(expandOutlineForChapter(baseState, 1, createMockProvider())).rejects.toThrow(
      '详细计划生成失败'
    )
  })

  it('returns warning issue when budget validation fails after max attempts', async () => {
    const badPlan: ChapterPlan = {
      sections: [
        {
          title: '核心事件',
          summary: '买办登场',
          wordCount: 1000,
          events: ['陈裕堂登门'],
          characters: ['苏半城', '陈裕堂'],
          timeMark: '午时',
        },
        {
          title: '过渡',
          summary: '亲王回话谈判',
          wordCount: 2000,
          events: ['回话亲王'],
          characters: ['苏半城', '亲王'],
          timeMark: '巳时',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '买办登场', fulfilled: true, section: '核心事件' }],
    }
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: badPlan })
    mockChatStructured.mockResolvedValue({ results: [true, false] })

    const result = await expandOutlineForChapter(baseState, 1, createMockProvider())

    expect(result.pendingIssues).toBeDefined()
    expect(result.pendingIssues!.length).toBe(1)
    expect(result.pendingIssues![0].type).toBe('outline_density')
    expect(result.pendingIssues![0].severity).toBe('warning')
    expect(result.pendingIssues![0].description).toContain('预算修正')
  })

  it('replans when the generated chapter time anchor contradicts the previous chapter', async () => {
    const invalidPlan: ChapterPlan = {
      sections: [
        {
          title: '错误锚点',
          summary: '错误地回到旧场景',
          wordCount: 3000,
          events: ['错误地回到医务室'],
          characters: ['主角'],
          timeMark: '上一章之前',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '承接上一章', fulfilled: true, section: '错误锚点' }],
      chapterTimeAnchor: '声称上一章已经回到教室',
    }
    const correctedPlan: ChapterPlan = {
      sections: [
        {
          title: '正确承接',
          summary: '从上一章结尾位置继续推进',
          wordCount: 3000,
          events: ['继续朝七班教室方向走'],
          characters: ['主角'],
          timeMark: '承接上一章结尾',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '承接上一章', fulfilled: true, section: '正确承接' }],
      chapterTimeAnchor: '承接上一章结尾',
    }
    planChapterWithOverrideMock
      .mockResolvedValueOnce({ chapterPlan: invalidPlan })
      .mockResolvedValueOnce({ chapterPlan: correctedPlan })
    vi.mocked(readChapterContent).mockResolvedValue(
      '上一章最后，主角已经离开医务室，沿走廊继续朝七班教室方向走。'
    )
    vi.mocked(contextJudge.batchValidateTimeAnchors)
      .mockResolvedValueOnce([
        {
          valid: false,
          reason: 'chapterTimeAnchor 声称上一章已经回到教室，但上一章正文没有该事件',
        },
      ])
      .mockResolvedValueOnce([{ valid: true }])

    const result = await expandOutlineForChapter(baseState, 1, createMockProvider())

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(2)
    expect(result.chapterPlan).toEqual({ ...correctedPlan, chapterIndex: 1 })
    const secondPlanState = planChapterWithOverrideMock.mock.calls[1]![1] as ReducedGraphState
    expect(secondPlanState.verifiedConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('chapterTimeAnchor 声称上一章已经回到教室'),
        }),
      ])
    )
  })

  it('removes the time anchor after two failed replans and reports a structured warning issue', async () => {
    const invalidPlan: ChapterPlan = {
      sections: [
        {
          title: '错误锚点',
          summary: '错误地回到旧场景',
          wordCount: 3000,
          events: ['错误地回到医务室'],
          characters: ['主角'],
          timeMark: '上一章之前',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '承接上一章', fulfilled: true, section: '错误锚点' }],
      chapterTimeAnchor: '声称上一章已经回到教室',
    }
    planChapterWithOverrideMock
      .mockResolvedValueOnce({ chapterPlan: invalidPlan })
      .mockResolvedValueOnce({ chapterPlan: invalidPlan })
    vi.mocked(readChapterContent).mockResolvedValue(
      '上一章最后，主角已经离开医务室，沿走廊继续朝七班教室方向走。'
    )
    vi.mocked(contextJudge.batchValidateTimeAnchors)
      .mockResolvedValueOnce([
        {
          valid: false,
          reason: 'chapterTimeAnchor 声称上一章已经回到教室，但上一章正文没有该事件',
        },
      ])
      .mockResolvedValueOnce([
        {
          valid: false,
          reason: 'chapterTimeAnchor 声称上一章已经回到教室，但上一章正文没有该事件',
        },
      ])

    const result = await expandOutlineForChapter(baseState, 1, createMockProvider())

    expect(planChapterWithOverrideMock).toHaveBeenCalledTimes(2)
    expect(result.chapterPlan.chapterTimeAnchor).toBeUndefined()
    const anchorIssue = result.pendingIssues?.find((i) => i.id === 'time-anchor-removed-1')
    expect(anchorIssue).toMatchObject({
      type: 'continuity',
      severity: 'warning',
      source: 'consistency',
      retryStrategy: 'fix',
    })
    expect(anchorIssue?.retryStrategy).not.toBe('manual')
  })
})

describe('validateChapterTimeAnchor', () => {
  beforeEach(() => {
    vi.mocked(contextJudge.batchValidateTimeAnchors).mockReset()
    vi.mocked(contextJudge.batchValidateTimeAnchors).mockResolvedValue([{ valid: true }])
  })

  it('passes when anchor does not claim previous events are completed', async () => {
    const plan: ChapterPlan = {
      sections: [],
      timeline: [],
      outlineCheck: [],
      chapterTimeAnchor: '三日期限第三日卯时（继续推进）',
    }

    const result = await validateChapterTimeAnchor(plan, '第六章正文：苏半城睡去。', {
      chat: vi.fn(),
    })

    expect(result.valid).toBe(true)
  })

  it('fails when anchor claims an event was completed in the previous chapter but text does not contain it', async () => {
    const plan: ChapterPlan = {
      sections: [],
      timeline: [],
      outlineCheck: [],
      chapterTimeAnchor: '三日期限第三日卯时末，昨日午时回话亲王已落地',
    }
    vi.mocked(contextJudge.batchValidateTimeAnchors).mockResolvedValueOnce([
      {
        valid: false,
        reason: 'chapterTimeAnchor 声称上一章已完成"回话亲王"，但上一章正文未提及该事件',
      },
    ])

    const result = await validateChapterTimeAnchor(
      plan,
      '第六章正文：苏半城亥时末睡去，次日清晨才起身赴王府。',
      { chat: vi.fn() }
    )

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('回话亲王')
  })

  it('passes when anchor claims completion and previous text contains the event', async () => {
    const plan: ChapterPlan = {
      sections: [],
      timeline: [],
      outlineCheck: [],
      chapterTimeAnchor: '三日期限第三日卯时末，昨日午时回话亲王已落地',
    }

    const result = await validateChapterTimeAnchor(
      plan,
      '第六章正文：苏半城昨日午时赴亲王府回话，当面答了办得成三字。',
      { chat: vi.fn() }
    )

    expect(result.valid).toBe(true)
  })
})

const defaultPlanningConfig = {
  coreEventRatioMin: 0.3,
  coreEventRatioTarget: 0.5,
  maxNonCoreSectionWordCount: 800,
  minCoreSectionWordCount: 1000,
  maxBackgroundTaskWordCount: 50,
  maxExecutedTaskRatio: 0.1,
  maxBridgeSceneRatio: 0.3,
  maxVerifiedConstraints: 20,
  maxNonErrorIssuesPerType: 3,
  closingForeshadowRecoveryRatio: 0.6,
  minSections: 3,
  maxSections: 6,
  minCoreSections: 2,
}

describe('validateChapterPlanBudget', () => {
  it('passes when core sections account for at least 50% of word count', async () => {
    const plan: ChapterPlan = {
      sections: [
        {
          title: '核心事件',
          summary: '买办登场',
          wordCount: 2500,
          events: ['陈裕堂登门'],
          characters: ['苏半城', '陈裕堂'],
          timeMark: '午时',
        },
        {
          title: '过渡',
          summary: '亲王回话收尾',
          wordCount: 800,
          events: ['回话亲王'],
          characters: ['苏半城'],
          timeMark: '巳时',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '买办登场', fulfilled: true, section: '核心事件' }],
    }

    const result = await validateChapterPlanBudget(plan, defaultPlanningConfig)

    expect(result.valid).toBe(true)
  })

  it('fails when core sections account for less than 50% of word count', async () => {
    const plan: ChapterPlan = {
      sections: [
        {
          title: '核心事件',
          summary: '买办登场',
          wordCount: 1000,
          events: ['陈裕堂登门'],
          characters: ['苏半城', '陈裕堂'],
          timeMark: '午时',
        },
        {
          title: '过渡',
          summary: '亲王回话谈判',
          wordCount: 2000,
          events: ['回话亲王'],
          characters: ['苏半城', '亲王'],
          timeMark: '巳时',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '买办登场', fulfilled: true, section: '核心事件' }],
    }

    const result = await validateChapterPlanBudget(plan, defaultPlanningConfig)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('50%')
  })

  it('fails when a non-core section exceeds 800 words', async () => {
    const plan: ChapterPlan = {
      sections: [
        {
          title: '核心事件',
          summary: '买办登场',
          wordCount: 3000,
          events: ['陈裕堂登门'],
          characters: ['苏半城', '陈裕堂'],
          timeMark: '午时',
        },
        {
          title: '过渡',
          summary: '亲王回话谈判',
          wordCount: 1200,
          events: ['回话亲王'],
          characters: ['苏半城', '亲王'],
          timeMark: '巳时',
        },
      ],
      timeline: [],
      outlineCheck: [{ requirement: '买办登场', fulfilled: true, section: '核心事件' }],
    }

    const result = await validateChapterPlanBudget(plan, defaultPlanningConfig)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('800')
  })

  it('passes for empty plans', async () => {
    const plan: ChapterPlan = {
      sections: [],
      timeline: [],
      outlineCheck: [],
    }

    const result = await validateChapterPlanBudget(plan, defaultPlanningConfig)

    expect(result.valid).toBe(true)
  })
})
