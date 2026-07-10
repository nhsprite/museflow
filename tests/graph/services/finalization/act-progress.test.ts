import { describe, expect, it } from 'vitest'
import {
  normalizeVerifiedBeats,
  getPendingMandatoryBeats,
  updateActProgress,
} from '@/graph/services/finalization/act-progress.js'
import type { ReducedGraphState } from '@/graph/state.js'
import type { StoryArc } from '@/types/outline.js'
import type { StoryMemory } from '@/types/story-memory.js'

describe('normalizeVerifiedBeats', () => {
  it('matches beats by exact string equality', () => {
    const verified = ['主角觉醒', '反派登场']
    const mandatory = ['主角觉醒', '揭示真相']
    expect(normalizeVerifiedBeats(verified, mandatory)).toEqual(['主角觉醒'])
  })

  it('does not match paraphrased beats', () => {
    const verified = ['主角终于觉醒']
    const mandatory = ['主角觉醒']
    expect(normalizeVerifiedBeats(verified, mandatory)).toEqual([])
  })
})

describe('getPendingMandatoryBeats', () => {
  it('returns mandatory beats not yet consumed', () => {
    const storyArc: StoryArc = {
      totalChapters: 3,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 3,
          title: 'Act 1',
          theme: '',
          function: '',
          mandatoryBeats: ['主角觉醒', '反派登场'],
        },
      ],
      keyBeats: [],
    }
    const state = {
      storyArc,
      actProgress: { 1: { consumed: ['主角觉醒'], pending: ['反派登场'] } },
    } as unknown as ReducedGraphState
    expect(getPendingMandatoryBeats(state, 1)).toEqual(['反派登场'])
  })
})

describe('updateActProgress', () => {
  function makeStoryArc(): StoryArc {
    return {
      totalChapters: 10,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 10,
          title: 'Act 1',
          theme: '',
          function: '',
          mandatoryBeats: ['身份暴露', '敌友洗牌', '终局布局'],
        },
      ],
      keyBeats: [
        {
          id: 'A1-B1',
          beat: '身份彻底暴露后的坠落',
          deadlineAct: 1,
          required: true,
        },
        {
          id: 'A1-B2',
          beat: '阵营重新洗牌',
          deadlineAct: 1,
          required: true,
        },
      ],
    }
  }

  function makeStoryMemory(overrides: Partial<StoryMemory> = {}): StoryMemory {
    return {
      version: '1',
      lastChapterIndex: 0,
      entities: { characters: {}, items: {}, locations: {}, factions: {}, plots: {} },
      events: [],
      foreshadows: {},
      beats: {},
      tasks: {},
      ...overrides,
    } as StoryMemory
  }

  it('preserves existing actProgress when memory beat text differs from mandatory beat text', async () => {
    const storyArc = makeStoryArc()
    const state = {
      storyArc,
      outline: [
        { number: 1, title: 'A', description: 'a' },
        { number: 2, title: 'B', description: 'b' },
      ],
      storyMemory: makeStoryMemory({
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
      }),
      actProgress: {
        1: { consumed: ['敌友洗牌'], pending: ['身份暴露', '终局布局'] },
      },
    } as unknown as ReducedGraphState

    const result = await updateActProgress(state, 1)

    expect(result.actProgress[1]?.consumed).toContain('敌友洗牌')
    expect(result.actProgress[1]?.consumed.length).toBeGreaterThanOrEqual(1)
  })

  it('does not consume legacy outline.verifiedBeats without mandatory beat IDs', async () => {
    const storyArc = makeStoryArc()
    const state = {
      storyArc,
      outline: [
        { number: 1, title: 'A', description: 'a', verifiedBeats: ['身份暴露'] },
        { number: 2, title: 'B', description: 'b' },
      ],
      storyMemory: makeStoryMemory(),
      actProgress: {
        1: { consumed: [], pending: ['身份暴露', '敌友洗牌', '终局布局'] },
      },
    } as unknown as ReducedGraphState

    const result = await updateActProgress(state, 1)

    expect(result.actProgress[1]?.consumed).not.toContain('身份暴露')
    expect(result.actProgress[1]?.pending).toContain('身份暴露')
  })

  it('consumes explicit verifiedMandatoryBeatIds even when keyBeat text differs', async () => {
    const storyArc = makeStoryArc()
    const state = {
      storyArc,
      outline: [
        { number: 1, title: 'A', description: 'a', verifiedMandatoryBeatIds: ['A1-M1'] },
        { number: 2, title: 'B', description: 'b' },
      ],
      storyMemory: makeStoryMemory(),
      actProgress: {
        1: { consumed: [], pending: ['身份暴露', '敌友洗牌', '终局布局'] },
      },
    } as unknown as ReducedGraphState

    const result = await updateActProgress(state, 1)

    expect(result.actProgress[1]?.consumed).toContain('身份暴露')
    expect(result.actProgress[1]?.pending).not.toContain('身份暴露')
  })

  it('uses paired claimedBeatIds and claimedBeats to consume mandatory beats when keyBeat text differs', async () => {
    const storyArc = makeStoryArc()
    const state = {
      storyArc,
      outline: [
        {
          number: 1,
          title: 'A',
          description: 'a',
          claimedBeats: ['身份暴露'],
          claimedBeatIds: ['A1-B1'],
        },
      ],
      storyMemory: makeStoryMemory({
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
      }),
      actProgress: {
        1: { consumed: [], pending: ['身份暴露', '敌友洗牌', '终局布局'] },
      },
    } as unknown as ReducedGraphState

    const result = await updateActProgress(state, 0)

    expect(result.actProgress[1]?.consumed).toContain('身份暴露')
    expect(result.actProgress[1]?.pending).not.toContain('身份暴露')
  })

  it('uses paired claimedBeatIds and claimedBeats for unverified beat issues', async () => {
    const storyArc = makeStoryArc()
    const state = {
      storyArc,
      currentChapterIndex: 8,
      outline: [
        ...Array.from({ length: 8 }, (_, index) => ({
          number: index + 1,
          title: `Chapter ${index + 1}`,
          description: '',
        })),
        {
          number: 9,
          title: 'A',
          description: 'a',
          claimedBeats: ['身份暴露'],
          claimedBeatIds: ['A1-B1'],
        },
      ],
      storyMemory: makeStoryMemory({
        beats: {
          'A1-B1': {
            id: 'A1-B1',
            description: '身份彻底暴露后的坠落',
            actIndex: 1,
            deadlineAct: 1,
            required: true,
            claimedIn: 8,
            provenByEventIds: [],
          },
        },
      }),
      actProgress: {
        1: { consumed: [], pending: ['身份暴露', '敌友洗牌', '终局布局'] },
      },
    } as unknown as ReducedGraphState

    const result = await updateActProgress(state, 8)

    expect(result.beatVerificationIssues).toEqual([
      expect.objectContaining({
        id: 'unverified-beat-id-A1-B1',
        severity: 'error',
        subject: 'A1-B1',
        description: expect.stringContaining('身份暴露'),
      }),
    ])
  })

  it('does not double-count consumed beats', async () => {
    const storyArc = makeStoryArc()
    const state = {
      storyArc,
      outline: [
        { number: 1, title: 'A', description: 'a', verifiedBeats: ['身份暴露'] },
        { number: 2, title: 'B', description: 'b' },
      ],
      storyMemory: makeStoryMemory({
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
      }),
      actProgress: {
        1: { consumed: ['身份暴露'], pending: ['敌友洗牌', '终局布局'] },
      },
    } as unknown as ReducedGraphState

    const result = await updateActProgress(state, 1)

    expect(result.actProgress[1]?.consumed.filter((b) => b === '身份暴露').length).toBe(1)
  })
})
