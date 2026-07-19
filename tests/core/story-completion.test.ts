import { describe, expect, it } from 'vitest'
import { evaluateStoryCompletion } from '../../src/core/story-completion.js'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import type { StoryArc } from '../../src/types/outline.js'
import type { StoryMemory } from '../../src/types/story-memory.js'

function storyArc(): StoryArc {
  return {
    totalChapters: 2,
    acts: [
      {
        index: 1,
        startChapter: 1,
        endChapter: 2,
        title: '终幕',
        theme: '',
        function: '',
        mandatoryBeats: ['完成核心对抗'],
      },
    ],
    keyBeats: [
      {
        id: 'A1-B1',
        beat: '角色承担最终代价',
        deadlineAct: 1,
        required: true,
      },
    ],
  }
}

function memoryWithProofs(): StoryMemory {
  return {
    ...createEmptyStoryMemory(),
    beats: {
      'A1-M1': {
        id: 'A1-M1',
        description: '完成核心对抗',
        actIndex: 1,
        deadlineAct: 1,
        required: true,
        claimedIn: 1,
        provenByEventIds: ['evt-mandatory'],
      },
      'A1-B1': {
        id: 'A1-B1',
        description: '角色承担最终代价',
        actIndex: 1,
        deadlineAct: 1,
        required: true,
        claimedIn: 1,
        provenByEventIds: ['evt-key'],
      },
    },
  }
}

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateStoryCompletion({
    currentChapterIndex: 2,
    totalChapters: 2,
    storyArc: storyArc(),
    storyMemory: memoryWithProofs(),
    pendingIssues: [],
    ...overrides,
  })
}

describe('evaluateStoryCompletion', () => {
  it('reports in-progress before the chapter boundary is reached', () => {
    const audit = evaluate({ currentChapterIndex: 1 })

    expect(audit.status).toBe('in_progress')
    expect(audit.chapterLimitReached).toBe(false)
  })

  it('blocks chapter-count-only completion when required beats lack proof', () => {
    const audit = evaluate({ storyMemory: createEmptyStoryMemory() })

    expect(audit.status).toBe('blocked')
    expect(audit.unprovenBeatIds).toEqual(['A1-M1', 'A1-B1'])
  })

  it('blocks unresolved must-resolve foreshadows', () => {
    const memory = memoryWithProofs()
    memory.foreshadows['fs-required'] = {
      id: 'fs-required',
      text: '待回收线索',
      kind: 'plot',
      introducedIn: 0,
      expectedFulfillChapter: 2,
      fulfilledIn: null,
      resolutionPolicy: 'must_resolve',
      required: true,
      beatId: null,
    }

    const audit = evaluate({ storyMemory: memory })

    expect(audit.status).toBe('blocked')
    expect(audit.unresolvedMustForeshadowIds).toEqual(['fs-required'])
  })

  it('does not hard-block unresolved should-resolve foreshadows', () => {
    const memory = memoryWithProofs()
    memory.foreshadows['fs-advisory'] = {
      id: 'fs-advisory',
      text: '可由类型策略决定的线索',
      kind: 'plot',
      introducedIn: 0,
      expectedFulfillChapter: 2,
      fulfilledIn: null,
      resolutionPolicy: 'should_resolve',
      required: false,
      beatId: null,
    }

    const audit = evaluate({ storyMemory: memory })

    expect(audit.status).toBe('complete')
    expect(audit.unresolvedShouldForeshadowIds).toEqual(['fs-advisory'])
  })

  it('blocks pending error issues', () => {
    const audit = evaluate({
      pendingIssues: [{ id: 'issue-1', severity: 'error' }],
    })

    expect(audit.status).toBe('blocked')
    expect(audit.pendingErrorIssueIds).toEqual(['issue-1'])
  })

  it('completes only when all structural obligations are satisfied', () => {
    const audit = evaluate()

    expect(audit).toMatchObject({
      status: 'complete',
      chapterLimitReached: true,
      unprovenBeatIds: [],
      unresolvedMustForeshadowIds: [],
      pendingErrorIssueIds: [],
    })
  })
})
