import { describe, expect, it } from 'vitest'
import { projectVerifiedClaimedBeatIdsIntoActProgress } from '../../src/core/act-progress-projection.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { StoryMemory } from '../../src/types/story-memory.js'

describe('projectVerifiedClaimedBeatIdsIntoActProgress', () => {
  it('adds verified claimedBeatIds to actProgress via paired claimedBeats without dropping existing progress', () => {
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
      currentChapterIndex: 1,
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
      ],
      storyMemory,
      actProgress: {
        1: { consumed: ['敌友洗牌'], pending: ['身份暴露'] },
      },
    } as unknown as ReducedGraphState

    const progress = projectVerifiedClaimedBeatIdsIntoActProgress(state)

    expect(progress[1]?.consumed).toEqual(['敌友洗牌', '身份暴露'])
    expect(progress[1]?.pending).toEqual([])
  })
})
