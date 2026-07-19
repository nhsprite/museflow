import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/storage/filesystem/writer.js', () => ({
  readChapterContentForRun: vi.fn(),
}))

import { validateChapterStructured } from '../../../src/graph/nodes/structured-validation.js'
import { createEmptyStoryMemory } from '../../../src/story-memory/projector.js'
import { readChapterContentForRun } from '../../../src/storage/filesystem/writer.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { ChapterPlan } from '../../../src/agents/types.js'
import type { StoryMemory, StoryEvent } from '../../../src/types/story-memory.js'
import { createMockContext } from '../../utils/mock-context.js'

describe('validateChapterStructured', () => {
  it('returns empty result when no plan', async () => {
    const state = {
      currentChapterIndex: 1,
      storyMemory: createEmptyStoryMemory(),
    } as ReducedGraphState
    const result = await validateChapterStructured(createMockContext(), state)
    expect(result.structuredValidationResult?.missingEvents).toHaveLength(0)
    expect(result.structuredValidationResult?.stateConflicts).toHaveLength(0)
  })

  it('detects missing event against plan', async () => {
    const plan: ChapterPlan = {
      chapterIndex: 1,
      sections: [],
      timeline: [],
      outlineCheck: [],
      expectedEvents: [
        {
          id: 'e1',
          type: 'character-location',
          characterId: 'c-1',
          locationId: 'l-1',
          chapterIndex: 1,
          source: 'chapter',
        },
      ],
      claimedBeatIds: [],
      fulfilledForeshadowIds: [],
      introducedForeshadowIds: [],
      resolvedTaskIds: [],
      createdTaskIds: [],
    }
    const state = {
      currentChapterIndex: 1,
      storyMemory: createEmptyStoryMemory(),
      chapterPlan: plan,
      draftChapterEvents: [],
    } as ReducedGraphState
    const result = await validateChapterStructured(createMockContext(), state)
    expect(result.structuredValidationResult?.missingEvents).toHaveLength(1)
    expect(result.structuredValidationResult?.missingEvents[0]?.id).toBe('e1')
  })

  it('does not flag legitimate intra-chapter movement as state conflict', async () => {
    const plan: ChapterPlan = {
      chapterIndex: 2,
      sections: [],
      timeline: [],
      outlineCheck: [],
      expectedEvents: [],
      claimedBeatIds: [],
      fulfilledForeshadowIds: [],
      introducedForeshadowIds: [],
      resolvedTaskIds: [],
      createdTaskIds: [],
    }
    const events: StoryEvent[] = [
      {
        id: 'e1',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'l-1',
        chapterIndex: 2,
        source: 'chapter',
      },
      {
        id: 'e2',
        type: 'character-location',
        characterId: 'c-1',
        locationId: 'l-2',
        chapterIndex: 2,
        source: 'chapter',
      },
    ]
    const state = {
      currentChapterIndex: 2,
      storyMemory: createEmptyStoryMemory(),
      chapterPlan: plan,
      draftChapterEvents: events,
    } as ReducedGraphState
    const result = await validateChapterStructured(createMockContext(), state)
    expect(result.structuredValidationResult?.stateConflicts).toHaveLength(0)
  })

  it('detects claimed but unproven beats', async () => {
    const plan: ChapterPlan = {
      chapterIndex: 3,
      sections: [],
      timeline: [],
      outlineCheck: [],
      expectedEvents: [],
      claimedBeatIds: ['beat-1'],
      fulfilledForeshadowIds: [],
      introducedForeshadowIds: [],
      resolvedTaskIds: [],
      createdTaskIds: [],
    }
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      beats: {
        'beat-1': {
          id: 'beat-1',
          description: '关键转折',
          actIndex: 0,
          deadlineAct: 1,
          required: true,
          claimedIn: 3,
          provenByEventIds: [],
        },
      },
    }
    const state = {
      currentChapterIndex: 3,
      storyMemory: memory,
      chapterPlan: plan,
      draftChapterEvents: [],
    } as ReducedGraphState
    const result = await validateChapterStructured(createMockContext(), state)
    expect(result.structuredValidationResult?.claimedButUnprovenBeats).toHaveLength(1)
    expect(result.structuredValidationResult?.claimedButUnprovenBeats[0]).toBe('beat-1')
  })

  it('treats current chapter plot-advance events as proof for claimed beats', async () => {
    vi.mocked(readChapterContentForRun).mockResolvedValueOnce('角色完成了不可逆的关键选择。')
    const plan: ChapterPlan = {
      chapterIndex: 3,
      sections: [],
      timeline: [],
      outlineCheck: [],
      expectedEvents: [
        {
          id: 'evt-expected',
          type: 'plot-advance',
          plotId: 'plot-1',
          beatId: 'beat-1',
          chapterIndex: 3,
          source: 'outline',
        },
      ],
      claimedBeatIds: ['beat-1'],
      fulfilledForeshadowIds: [],
      introducedForeshadowIds: [],
      resolvedTaskIds: [],
      createdTaskIds: [],
    }
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      beats: {
        'beat-1': {
          id: 'beat-1',
          description: '关键转折',
          actIndex: 1,
          deadlineAct: 1,
          required: true,
          claimedIn: 3,
          provenByEventIds: [],
        },
      },
    }
    const state = {
      currentChapterIndex: 3,
      storyMemory: memory,
      chapterPlan: plan,
      draftChapterEvents: [
        {
          id: 'evt-1',
          type: 'plot-advance',
          plotId: 'plot-1',
          beatId: 'beat-1',
          chapterIndex: 3,
          source: 'chapter',
          evidence: { paragraphIndex: 1 },
        },
      ],
      story: { outputDir: '/tmp/semantic-plot-test' },
    } as ReducedGraphState
    const context = createMockContext()
    vi.mocked(context.provider.chatStructured!).mockResolvedValueOnce({
      judgments: [
        {
          eventId: 'evt-1',
          beatId: 'beat-1',
          verdict: 'proven',
          reason: '证据完整实现了节拍。',
        },
      ],
    })

    const result = await validateChapterStructured(context, state)

    expect(context.provider.chatStructured).toHaveBeenCalledTimes(1)
    expect(result.structuredValidationResult?.claimedButUnprovenBeats).toEqual([])
    expect(result.structuredValidationResult?.plotAdvanceRejections).toEqual([])
  })

  it('does not accept an in-range paragraph index as semantic proof of a beat', async () => {
    vi.mocked(readChapterContentForRun).mockResolvedValueOnce('角色仍维持原状，没有作出选择。')
    const event: StoryEvent = {
      id: 'evt-false-proof',
      type: 'plot-advance',
      plotId: 'plot-1',
      beatId: 'beat-1',
      chapterIndex: 3,
      source: 'chapter',
      evidence: { paragraphIndex: 1 },
    }
    const plan: ChapterPlan = {
      chapterIndex: 3,
      sections: [],
      timeline: [],
      outlineCheck: [],
      expectedEvents: [{ ...event, id: 'evt-expected', source: 'outline' }],
      claimedBeatIds: ['beat-1'],
      fulfilledForeshadowIds: [],
      introducedForeshadowIds: [],
      resolvedTaskIds: [],
      createdTaskIds: [],
    }
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      beats: {
        'beat-1': {
          id: 'beat-1',
          description: '角色作出不可逆的关键选择',
          actIndex: 1,
          deadlineAct: 1,
          required: true,
          claimedIn: 3,
          provenByEventIds: [],
        },
      },
    }
    const context = createMockContext()
    vi.mocked(context.provider.chatStructured!).mockResolvedValueOnce({
      judgments: [
        {
          eventId: 'evt-false-proof',
          beatId: 'beat-1',
          verdict: 'not_proven',
          reason: '证据没有发生要求的选择。',
        },
      ],
    })
    const state = {
      currentChapterIndex: 3,
      story: { outputDir: '/tmp/semantic-plot-test' },
      storyMemory: memory,
      chapterPlan: plan,
      draftChapterEvents: [event],
    } as ReducedGraphState

    const result = await validateChapterStructured(context, state)

    expect(context.provider.chatStructured).toHaveBeenCalledTimes(1)
    expect(result.structuredValidationResult?.claimedButUnprovenBeats).toEqual(['beat-1'])
    expect(result.structuredValidationResult?.plotAdvanceRejections).toEqual([
      {
        eventId: 'evt-false-proof',
        beatId: 'beat-1',
        evidenceParagraphIndex: 1,
        verdict: 'not_proven',
        reason: '证据没有发生要求的选择。',
      },
    ])
  })

  it('validates chapter final-state declarations against draft events', async () => {
    const plan: ChapterPlan = {
      chapterIndex: 24,
      sections: [],
      timeline: [],
      outlineCheck: [],
      expectedEvents: [],
      claimedBeatIds: [],
      fulfilledForeshadowIds: [],
      introducedForeshadowIds: [],
      resolvedTaskIds: [],
      createdTaskIds: [],
    }
    const events: StoryEvent[] = [
      {
        id: 'e1',
        type: 'item-location',
        itemId: 'i-box',
        holderId: null,
        locationId: 'loc-drawer-deep',
        chapterIndex: 24,
        source: 'chapter',
      },
    ]
    const state = {
      currentChapterIndex: 24,
      storyMemory: createEmptyStoryMemory(),
      chapterPlan: plan,
      draftChapterEvents: events,
      chapterFinalStateDeclarations: [
        { entityId: 'i-box', attribute: 'location', value: 'loc-drawer-right' },
      ],
    } as ReducedGraphState

    const result = await validateChapterStructured(createMockContext(), state)

    expect(result.structuredValidationResult?.finalStateMismatches).toEqual([
      {
        entityId: 'i-box',
        attribute: 'location',
        declaredValue: 'loc-drawer-right',
        actualValue: 'loc-drawer-deep',
      },
    ])
  })

  it('merges semantic fulfillment rejections into the blocking false-fulfillment list', async () => {
    vi.mocked(readChapterContentForRun).mockResolvedValueOnce(
      '第一段给出伏笔的明确因果解释。\n\n第二段只再次提到原有细节。'
    )
    const firstEvent: StoryEvent = {
      id: 'fulfill-a',
      type: 'foreshadow-fulfill',
      foreshadowId: 'fs-a',
      chapterIndex: 4,
      source: 'chapter',
      evidence: { paragraphIndex: 1 },
    }
    const secondEvent: StoryEvent = {
      id: 'fulfill-b',
      type: 'foreshadow-fulfill',
      foreshadowId: 'fs-b',
      chapterIndex: 4,
      source: 'chapter',
      evidence: { paragraphIndex: 2 },
    }
    const plan: ChapterPlan = {
      chapterIndex: 4,
      sections: [],
      timeline: [],
      outlineCheck: [],
      expectedEvents: [firstEvent, secondEvent],
      claimedBeatIds: [],
      fulfilledForeshadowIds: ['fs-a', 'fs-b'],
      introducedForeshadowIds: [],
      resolvedTaskIds: [],
      createdTaskIds: [],
    }
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        'fs-a': {
          id: 'fs-a',
          text: '一个需要因果解释的细节',
          kind: 'plot',
          introducedIn: 1,
          expectedFulfillChapter: 5,
          fulfilledIn: null,
          resolutionPolicy: 'must_resolve',
          required: true,
          beatId: null,
        },
        'fs-b': {
          id: 'fs-b',
          text: '另一个需要解释的细节',
          kind: 'plot',
          introducedIn: 2,
          expectedFulfillChapter: 5,
          fulfilledIn: null,
          resolutionPolicy: 'must_resolve',
          required: true,
          beatId: null,
        },
      },
    }
    const context = createMockContext()
    vi.mocked(context.provider.chatStructured!).mockResolvedValueOnce({
      judgments: [
        { foreshadowId: 'fs-a', verdict: 'fulfilled', reason: '证据完成了解释。' },
        {
          foreshadowId: 'fs-b',
          verdict: 'not_fulfilled',
          reason: '证据只有重复提及。',
        },
      ],
    })
    const state = {
      currentChapterIndex: 4,
      story: { outputDir: '/tmp/semantic-fulfillment-test' },
      storyMemory: memory,
      chapterPlan: plan,
      draftChapterEvents: [firstEvent, secondEvent],
    } as ReducedGraphState

    const result = await validateChapterStructured(context, state)

    expect(context.provider.chatStructured).toHaveBeenCalledTimes(1)
    expect(result.structuredValidationResult?.falseFulfillments).toEqual(['fs-b'])
    expect(result.structuredValidationResult?.foreshadowFulfillmentRejections).toEqual([
      {
        foreshadowId: 'fs-b',
        evidenceParagraphIndex: 2,
        verdict: 'not_fulfilled',
        reason: '证据只有重复提及。',
      },
    ])
  })

  it('does not semantically verify unexpected fulfillment events', async () => {
    vi.mocked(readChapterContentForRun).mockResolvedValueOnce('正文。')
    const event: StoryEvent = {
      id: 'unexpected-fulfill',
      type: 'foreshadow-fulfill',
      foreshadowId: 'fs-a',
      chapterIndex: 4,
      source: 'chapter',
      evidence: { paragraphIndex: 1 },
    }
    const plan: ChapterPlan = {
      chapterIndex: 4,
      sections: [],
      timeline: [],
      outlineCheck: [],
      expectedEvents: [],
      claimedBeatIds: [],
      fulfilledForeshadowIds: [],
      introducedForeshadowIds: [],
      resolvedTaskIds: [],
      createdTaskIds: [],
    }
    const context = createMockContext()
    const state = {
      currentChapterIndex: 4,
      story: { outputDir: '/tmp/semantic-fulfillment-test' },
      storyMemory: {
        ...createEmptyStoryMemory(),
        foreshadows: {
          'fs-a': {
            id: 'fs-a',
            text: '一个需要解释的细节',
            kind: 'plot',
            introducedIn: 1,
            expectedFulfillChapter: 5,
            fulfilledIn: null,
            resolutionPolicy: 'must_resolve',
            required: true,
            beatId: null,
          },
        },
      },
      chapterPlan: plan,
      draftChapterEvents: [event],
    } as ReducedGraphState

    const result = await validateChapterStructured(context, state)

    expect(context.provider.chatStructured).not.toHaveBeenCalled()
    expect(result.structuredValidationResult?.unexpectedEvents).toEqual([event])
  })
})
