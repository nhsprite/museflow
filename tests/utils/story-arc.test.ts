import { describe, expect, it } from 'vitest'
import {
  buildArcStatus,
  buildClosingPhaseConstraint,
  isClosingPhase,
  proposeActBoundaryAdjustments,
  validateActBoundaryAdjustment,
  applyActBoundaryAdjustment,
  judgeMandatoryBeatCoverage,
} from '../../src/utils/story-arc.js'
import type { StoryArc } from '../../src/types/outline.js'

function makeStoryArc(): StoryArc {
  return {
    totalChapters: 20,
    acts: [
      {
        index: 1,
        startChapter: 1,
        endChapter: 5,
        title: '入局',
        theme: '卷入',
        function: '建立',
        mandatoryBeats: ['主角失去庇护', '反派首次施压'],
      },
      {
        index: 2,
        startChapter: 6,
        endChapter: 10,
        title: '反击',
        theme: '成长',
        function: '对抗',
        mandatoryBeats: ['主角找到盟友'],
      },
      {
        index: 3,
        startChapter: 11,
        endChapter: 15,
        title: '揭秘',
        theme: '真相',
        function: '揭露',
        mandatoryBeats: ['核心秘密揭晓'],
      },
      {
        index: 4,
        startChapter: 16,
        endChapter: 20,
        title: '决战',
        theme: '高潮',
        function: '解决',
        mandatoryBeats: ['最终对决'],
      },
    ],
    keyBeats: [
      { id: 'A2-B1', beat: '核心秘密被主角获悉', deadlineAct: 2, required: true },
      { id: 'A4-B1', beat: '最终对决', deadlineAct: 4, required: true },
    ],
  }
}

describe('story-arc utilities', () => {
  it('detects closing phase based on ratio', () => {
    expect(isClosingPhase(20, 16)).toBe(true)
    expect(isClosingPhase(20, 15)).toBe(false)
    expect(isClosingPhase(20, 16, 0.2)).toBe(true)
    expect(isClosingPhase(20, 15, 0.2)).toBe(true)
    expect(isClosingPhase(20, 14, 0.2)).toBe(false)
  })

  it('builds arc status with current act and pending beats', () => {
    const storyArc = makeStoryArc()
    const actProgress = {
      1: { consumed: ['主角失去庇护'], pending: ['反派首次施压'] },
    }
    const status = buildArcStatus(storyArc, actProgress, 1)

    expect(status.currentAct?.index).toBe(1)
    expect(status.beatsTotal).toBe(2)
    expect(status.beatsConsumed).toBe(1)
    expect(status.beatsPending).toEqual(['反派首次施压'])
    expect(status.riskLevel).toBe('low')
  })

  it('marks high risk when pending beats exceed remaining chapters', () => {
    const storyArc = makeStoryArc()
    const actProgress = {
      1: { consumed: [], pending: ['主角失去庇护', '反派首次施压'] },
    }
    const status = buildArcStatus(storyArc, actProgress, 3)

    expect(status.beatsPending).toHaveLength(2)
    expect(status.riskLevel).toBe('high')
  })

  it('marks high risk when key beat is overdue', () => {
    const storyArc = makeStoryArc()
    const actProgress = {
      1: { consumed: ['主角失去庇护', '反派首次施压'], pending: [] },
      2: { consumed: ['主角找到盟友'], pending: [] },
      3: { consumed: [], pending: ['核心秘密揭晓'] },
    }
    const status = buildArcStatus(storyArc, actProgress, 10)

    expect(status.overdueKeyBeats).toHaveLength(1)
    expect(status.overdueKeyBeats[0]?.beat).toBe('核心秘密被主角获悉')
    expect(status.riskLevel).toBe('high')
  })

  it('proposes extension when pending beats exceed capacity near boundary', () => {
    const storyArc = makeStoryArc()
    const actProgress = {
      1: { consumed: [], pending: ['主角失去庇护', '反派首次施压'] },
    }
    const proposals = proposeActBoundaryAdjustments(storyArc, actProgress, 3)

    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.actIndex).toBe(1)
    expect(proposals[0]?.proposedEndChapter).toBeGreaterThan(5)
  })

  it('proposes reduction when all beats consumed before boundary', () => {
    const storyArc = makeStoryArc()
    const actProgress = {
      1: { consumed: ['主角失去庇护', '反派首次施压'], pending: [] },
    }
    const proposals = proposeActBoundaryAdjustments(storyArc, actProgress, 3)

    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.actIndex).toBe(1)
    expect(proposals[0]?.proposedEndChapter).toBeLessThan(5)
  })

  it('does not propose adjustment far from boundary', () => {
    const storyArc = makeStoryArc()
    const actProgress = {
      1: { consumed: [], pending: ['主角失去庇护', '反派首次施压'] },
    }
    const proposals = proposeActBoundaryAdjustments(storyArc, actProgress, 1)

    expect(proposals).toHaveLength(0)
  })

  it('validates boundary adjustment', () => {
    const storyArc = makeStoryArc()

    expect(validateActBoundaryAdjustment(storyArc, 1, 6, 3).valid).toBe(true)
    expect(validateActBoundaryAdjustment(storyArc, 1, 2, 3).valid).toBe(false)
    expect(validateActBoundaryAdjustment(storyArc, 1, 12, 3).valid).toBe(true)
    expect(validateActBoundaryAdjustment(storyArc, 2, 4, 3).valid).toBe(false)
    expect(validateActBoundaryAdjustment(storyArc, 99, 6, 3).valid).toBe(false)
  })

  it('builds closing phase constraint near the end', () => {
    const storyArc = makeStoryArc()
    const actProgress = {
      1: { consumed: ['主角失去庇护'], pending: ['反派首次施压'] },
      2: { consumed: [], pending: ['主角找到盟友'] },
      3: { consumed: [], pending: ['核心秘密揭晓'] },
      4: { consumed: [], pending: ['最终对决'] },
    }
    const constraint = buildClosingPhaseConstraint(storyArc, actProgress, 17)

    expect(constraint).toContain('全书收尾阶段')
    expect(constraint).toContain('禁止引入新的主要支线')
    expect(constraint).toContain('最终对决')
  })

  it('returns undefined when not in closing phase', () => {
    const storyArc = makeStoryArc()
    const constraint = buildClosingPhaseConstraint(storyArc, {}, 5)

    expect(constraint).toBeUndefined()
  })

  describe('judgeMandatoryBeatCoverage', () => {
    it('returns matched beat strings from model response', async () => {
      const provider = {
        chat: async () => '',
        chatStructured: async () => ({
          coveredBeats: ['主角失去庇护', '反派首次施压', '不相关的描述'],
        }),
      }
      const beats = ['主角失去庇护', '反派首次施压']
      const covered = await judgeMandatoryBeatCoverage(
        provider,
        '主角被逐出家门，反派派人警告。',
        beats
      )
      expect(covered).toEqual(['主角失去庇护', '反派首次施压'])
    })

    it('falls back to chat when chatStructured is unavailable', async () => {
      const provider = {
        chat: async () => '{"coveredBeats": ["主角失去庇护"]}',
      }
      const beats = ['主角失去庇护', '反派首次施压']
      const covered = await judgeMandatoryBeatCoverage(provider, '主角被逐出家门。', beats)
      expect(covered).toEqual(['主角失去庇护'])
    })

    it('ignores model-returned beat text that is not an exact candidate', async () => {
      const provider = {
        chatStructured: async () => ({
          coveredBeats: ['沈砚秋改名换姓，以新身份回到京城并初步立足'],
        }),
      }
      const beats = ['主角以新身份重返京城并初步立足']
      const covered = await judgeMandatoryBeatCoverage(provider, '...', beats)
      expect(covered).toEqual([])
    })
  })

  describe('applyActBoundaryAdjustment', () => {
    it('extends act end chapter and shifts next act start', () => {
      const storyArc = makeStoryArc()
      const proposal = { actIndex: 1, proposedEndChapter: 7, reason: 'test' }
      const result = applyActBoundaryAdjustment(storyArc, proposal, 3)

      expect(result.applied).toBe(true)
      expect(result.storyArc.acts[0]?.endChapter).toBe(7)
      expect(result.storyArc.acts[1]?.startChapter).toBe(8)
    })

    it('extends an act by shifting all following acts and increasing total chapters', () => {
      const storyArc = makeStoryArc()
      const proposal = { actIndex: 1, proposedEndChapter: 7, reason: 'test' }
      const result = applyActBoundaryAdjustment(storyArc, proposal, 3)

      expect(result.applied).toBe(true)
      expect(result.storyArc.totalChapters).toBe(22)
      expect(result.storyArc.acts.map((act) => [act.startChapter, act.endChapter])).toEqual([
        [1, 7],
        [8, 12],
        [13, 17],
        [18, 22],
      ])
    })

    it('records global automatic extension budget usage', () => {
      const storyArc = makeStoryArc()
      const proposal = { actIndex: 1, proposedEndChapter: 7, reason: 'test' }
      const result = applyActBoundaryAdjustment(storyArc, proposal, 3)

      expect(result.applied).toBe(true)
      expect(result.storyArc.autoBoundaryAdjustment).toEqual({
        originalTotalChapters: 20,
        totalExtendedChapters: 2,
      })
    })

    it('applies shortening proposals and shifts next act start earlier', () => {
      const storyArc = makeStoryArc()
      const proposal = { actIndex: 1, proposedEndChapter: 4, reason: 'test' }
      const result = applyActBoundaryAdjustment(storyArc, proposal, 3)

      expect(result.applied).toBe(true)
      expect(result.storyArc.acts[0]?.endChapter).toBe(4)
      expect(result.storyArc.acts[1]?.startChapter).toBe(5)
    })

    it('caps extension to 3 chapters', () => {
      const storyArc = makeStoryArc()
      const proposal = { actIndex: 1, proposedEndChapter: 10, reason: 'test' }
      const result = applyActBoundaryAdjustment(storyArc, proposal, 3)

      expect(result.applied).toBe(true)
      expect(result.storyArc.acts[0]?.endChapter).toBe(8)
    })

    it('caps automatic extension while preserving following act lengths', () => {
      const storyArc = makeStoryArc()
      const proposal = { actIndex: 1, proposedEndChapter: 10, reason: 'test' }
      const result = applyActBoundaryAdjustment(storyArc, proposal, 3)

      expect(result.storyArc.acts.map((act) => act.endChapter - act.startChapter + 1)).toEqual([
        8, 5, 5, 5,
      ])
    })

    it('blocks repeated automatic extension beyond the cumulative act budget', () => {
      const storyArc: StoryArc = {
        totalChapters: 30,
        acts: [
          {
            index: 1,
            startChapter: 1,
            endChapter: 5,
            title: '入局',
            theme: '卷入',
            function: '建立',
            mandatoryBeats: ['beat1', 'beat2'],
          },
          {
            index: 2,
            startChapter: 6,
            endChapter: 20,
            title: '对抗',
            theme: '升级',
            function: '对抗',
            mandatoryBeats: ['beat3'],
          },
          {
            index: 3,
            startChapter: 21,
            endChapter: 30,
            title: '收束',
            theme: '完结',
            function: '解决',
            mandatoryBeats: ['beat4'],
          },
        ],
        keyBeats: [],
      }

      const first = applyActBoundaryAdjustment(
        storyArc,
        { actIndex: 1, proposedEndChapter: 8, reason: 'first extension' },
        3
      )
      expect(first.applied).toBe(true)
      expect(first.storyArc.acts[0]?.endChapter).toBe(8)

      const second = applyActBoundaryAdjustment(
        first.storyArc,
        { actIndex: 1, proposedEndChapter: 11, reason: 'second extension' },
        6
      )

      expect(second.applied).toBe(false)
      expect(second.requiresManualResolution).toBe(true)
      expect(second.storyArc.acts[0]?.endChapter).toBe(8)
      expect(second.reason).toContain('累计自动延长上限')
    })

    it('blocks automatic extension when global extension budget is exhausted', () => {
      const storyArc = makeStoryArc()
      const first = applyActBoundaryAdjustment(
        storyArc,
        { actIndex: 1, proposedEndChapter: 8, reason: 'first extension' },
        3
      )

      expect(first.applied).toBe(true)
      expect(first.storyArc.autoBoundaryAdjustment?.totalExtendedChapters).toBe(3)

      const second = applyActBoundaryAdjustment(
        first.storyArc,
        { actIndex: 2, proposedEndChapter: 15, reason: 'second extension' },
        11
      )

      expect(second.applied).toBe(false)
      expect(second.requiresManualResolution).toBe(true)
      expect(second.reason).toContain('全书累计自动延长上限')
    })
  })
})
