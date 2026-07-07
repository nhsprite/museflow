import { describe, expect, it } from 'vitest'
import { recomputeActProgressForRewrite } from '../../src/core/rewrite-state.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { StoryMemory } from '../../src/types/story-memory.js'

describe('recomputeActProgressForRewrite', () => {
  it('maps verified claimedBeatIds back to mandatory beat text when keyBeat text differs', () => {
    const storyMemory: StoryMemory = {
      version: '1',
      lastChapterIndex: 0,
      entities: { characters: {}, items: {}, locations: {}, factions: {}, plots: {} },
      events: [],
      foreshadows: {},
      beats: {
        'A1-B1': {
          id: 'A1-B1',
          description: '身份彻底暴露后的坠落',
          actIndex: 1,
          deadlineAct: 1,
          required: true,
          claimedIn: 0,
          provenByEventIds: ['evt-1'],
        },
      },
      tasks: {},
    }
    const state = {
      storyArc: {
        totalChapters: 3,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 3,
            title: 'Act',
            theme: '',
            function: '',
            mandatoryBeats: ['身份暴露', '敌友洗牌'],
          },
        ],
        keyBeats: [
          {
            id: 'A1-B1',
            beat: '身份彻底暴露后的坠落',
            deadlineAct: 1,
            required: true,
          },
        ],
      },
      outline: [
        {
          number: 1,
          title: 'Chapter 1',
          description: 'Description 1',
          claimedBeats: ['身份暴露'],
          claimedBeatIds: ['A1-B1'],
        },
        { number: 2, title: 'Chapter 2', description: 'Description 2' },
      ],
      storyMemory,
    } as unknown as ReducedGraphState

    const progress = recomputeActProgressForRewrite(state, 1)

    expect(progress[1]?.consumed).toContain('身份暴露')
    expect(progress[1]?.pending).not.toContain('身份暴露')
  })
})
