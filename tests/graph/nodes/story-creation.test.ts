import { describe, expect, it, vi } from 'vitest'
import { validate_outline } from '../../../src/graph/nodes/story-creation.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { StoryArc } from '../../../src/types/outline.js'
import { createMockContext } from '../../utils/mock-context.js'

function legacyArc(): StoryArc {
  return {
    totalChapters: 3,
    acts: [
      {
        index: 1,
        startChapter: 1,
        endChapter: 3,
        title: '第一幕',
        theme: '',
        function: '',
        mandatoryBeats: ['完成关键转折'],
      },
    ],
    keyBeats: [{ id: 'A1-B1', beat: '完成关键转折', deadlineAct: 1, required: true }],
  }
}

describe('validate_outline beat coverage', () => {
  it('fills a missing structured coverage declaration before accepting a new story arc', async () => {
    const context = createMockContext()
    context.provider.chatStructured = vi.fn().mockResolvedValue({
      decisions: [{ keyBeatId: 'A1-B1', covered: true, mandatoryBeatId: 'A1-M1' }],
    })

    const result = await validate_outline(context, {
      storyArc: legacyArc(),
      totalChapters: 3,
      pendingIssues: [],
    } as ReducedGraphState)

    expect(result.storyArc?.keyBeats[0]?.coveredByMandatoryBeatId).toBe('A1-M1')
    expect(result.pendingIssues).toEqual([])
  })

  it('rejects a declared coverage link that points beyond the key beat deadline', async () => {
    const storyArc: StoryArc = {
      totalChapters: 4,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 2,
          title: '第一幕',
          theme: '',
          function: '',
          mandatoryBeats: ['第一幕义务'],
        },
        {
          index: 2,
          startChapter: 3,
          endChapter: 4,
          title: '第二幕',
          theme: '',
          function: '',
          mandatoryBeats: ['第二幕义务'],
        },
      ],
      keyBeats: [
        {
          id: 'A1-B1',
          beat: '第一幕义务',
          deadlineAct: 1,
          required: true,
          coveredByMandatoryBeatId: 'A2-M1',
        },
      ],
    }

    const result = await validate_outline(createMockContext(), {
      storyArc,
      totalChapters: 4,
      pendingIssues: [],
    } as ReducedGraphState)

    expect(result.pendingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'story-arc.beat-coverage-invalid', subject: 'A1-B1' }),
      ])
    )
  })
})
