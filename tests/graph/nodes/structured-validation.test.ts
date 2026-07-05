import { describe, it, expect } from 'vitest'
import { validateChapterStructured } from '../../../src/graph/nodes/structured-validation.js'
import { createEmptyStoryMemory } from '../../../src/story-memory/projector.js'
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

  it('detects state conflicts in the same chapter', async () => {
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
    expect(result.structuredValidationResult?.stateConflicts).toHaveLength(1)
    expect(result.structuredValidationResult?.stateConflicts[0]?.entityId).toBe('c-1')
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
})
