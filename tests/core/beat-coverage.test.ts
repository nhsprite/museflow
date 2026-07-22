import { describe, expect, it, vi } from 'vitest'
import {
  auditKeyBeatCoverage,
  getVerifiedBeatIdsWithCoverage,
  isBeatProven,
  mergeKeyBeatCoverageMetadata,
} from '../../src/core/beat-coverage.js'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import type { ModelProvider } from '../../src/model/provider.js'
import type { StoryArc } from '../../src/types/outline.js'

function makeArc(): StoryArc {
  return {
    totalChapters: 4,
    acts: [
      {
        index: 1,
        startChapter: 1,
        endChapter: 4,
        title: '第一幕',
        theme: '',
        function: '',
        mandatoryBeats: ['真相完整揭开', '对手正式登场'],
      },
    ],
    keyBeats: [
      { id: 'A1-B1', beat: '真相完整揭开', deadlineAct: 1, required: true },
      { id: 'A1-B2', beat: '主角改变立场', deadlineAct: 1, required: true },
    ],
  }
}

function providerWith(result: unknown): ModelProvider {
  return {
    chat: vi.fn().mockResolvedValue(''),
    chatStructured: vi.fn().mockResolvedValue(result),
  }
}

describe('beat coverage', () => {
  it('reuses mandatory proof for a structurally linked key beat', () => {
    const storyArc = makeArc()
    storyArc.keyBeats[0]!.coveredByMandatoryBeatId = 'A1-M1'
    storyArc.keyBeats[1]!.coveredByMandatoryBeatId = null
    const memory = createEmptyStoryMemory()
    memory.beats['A1-M1'] = {
      id: 'A1-M1',
      description: '真相完整揭开',
      actIndex: 1,
      deadlineAct: 1,
      required: true,
      claimedIn: 2,
      provenByEventIds: ['evt-proof'],
    }

    expect(isBeatProven(storyArc, memory, 'A1-B1')).toBe(true)
    expect(isBeatProven(storyArc, memory, 'A1-B2')).toBe(false)
    expect(getVerifiedBeatIdsWithCoverage(memory, storyArc)).toEqual(['A1-M1', 'A1-B1'])
  })

  it('audits every legacy key beat into either a link or an explicit independent marker', async () => {
    const storyArc = makeArc()
    const provider = providerWith({
      decisions: [
        { keyBeatId: 'A1-B1', covered: true, mandatoryBeatId: 'A1-M1' },
        { keyBeatId: 'A1-B2', covered: false, mandatoryBeatId: '' },
      ],
    })

    const result = await auditKeyBeatCoverage(storyArc, provider)

    expect(result.changed).toBe(true)
    expect(result.linkedKeyBeatIds).toEqual(['A1-B1'])
    expect(result.independentKeyBeatIds).toEqual(['A1-B2'])
    expect(result.storyArc.keyBeats).toEqual([
      expect.objectContaining({ id: 'A1-B1', coveredByMandatoryBeatId: 'A1-M1' }),
      expect.objectContaining({ id: 'A1-B2', coveredByMandatoryBeatId: null }),
    ])
  })

  it('rejects incomplete audit output without partially mutating the arc', async () => {
    const storyArc = makeArc()
    const provider = providerWith({
      decisions: [{ keyBeatId: 'A1-B1', covered: true, mandatoryBeatId: 'A1-M1' }],
    })

    const result = await auditKeyBeatCoverage(storyArc, provider)

    expect(result.changed).toBe(false)
    expect(result.storyArc).toBe(storyArc)
    expect(provider.chatStructured).toHaveBeenCalledTimes(2)
  })

  it('carries audited metadata from the latest checkpoint into a rewrite marker arc', () => {
    const markerArc = makeArc()
    const authorityArc = makeArc()
    authorityArc.keyBeats[0]!.coveredByMandatoryBeatId = 'A1-M1'
    authorityArc.keyBeats[1]!.coveredByMandatoryBeatId = null

    const merged = mergeKeyBeatCoverageMetadata(markerArc, authorityArc)

    expect(merged?.keyBeats).toEqual([
      expect.objectContaining({ id: 'A1-B1', coveredByMandatoryBeatId: 'A1-M1' }),
      expect.objectContaining({ id: 'A1-B2', coveredByMandatoryBeatId: null }),
    ])
  })
})
