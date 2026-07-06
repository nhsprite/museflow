import { describe, expect, it } from 'vitest'
import {
  normalizeVerifiedBeats,
  getPendingMandatoryBeats,
} from '@/graph/services/finalization/act-progress.js'
import type { ReducedGraphState } from '@/graph/state.js'
import type { StoryArc } from '@/types/outline.js'

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
