import { describe, expect, it } from 'vitest'
import {
  buildArcStatus,
  buildClosingPhaseConstraint,
  isClosingPhase,
  proposeActExtensionAfterForeshadowAdjudication,
  proposeActBoundaryAdjustments,
  validateActBoundaryAdjustment,
  applyActBoundaryAdjustment as applyConfiguredActBoundaryAdjustment,
  calculateBeatBudget,
} from '../../src/utils/story-arc.js'
import { DEFAULT_CHAPTER_PLANNING_CONFIG } from '../../src/utils/chapter-planning.js'
import type { StoryArc } from '../../src/types/outline.js'
import type { StoryMemory } from '../../src/types/story-memory.js'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'

const completedActProgress = {
  1: { consumed: ['主角失去庇护', '反派首次施压'], pending: [] },
}

function applyActBoundaryAdjustment(
  storyArc: Parameters<typeof applyConfiguredActBoundaryAdjustment>[0],
  proposal: Parameters<typeof applyConfiguredActBoundaryAdjustment>[1],
  currentChapterIndex: number,
  policy?: Parameters<typeof applyConfiguredActBoundaryAdjustment>[3]
): ReturnType<typeof applyConfiguredActBoundaryAdjustment> {
  return applyConfiguredActBoundaryAdjustment(
    storyArc,
    proposal,
    currentChapterIndex,
    policy ?? DEFAULT_CHAPTER_PLANNING_CONFIG
  )
}

function memoryWithForeshadow(overrides: Partial<StoryMemory['foreshadows'][string]>): StoryMemory {
  return {
    ...createEmptyStoryMemory(),
    foreshadows: {
      'fs-act1': {
        id: 'fs-act1',
        text: '一枚旧邮票',
        kind: 'object_foreshadow',
        introducedIn: 1,
        expectedFulfillChapter: 4,
        fulfilledIn: null,
        resolutionPolicy: 'must_resolve',
        required: true,
        beatId: 'beat-act1',
        ...overrides,
      },
    },
    beats: {
      'beat-act1': {
        id: 'beat-act1',
        description: '旧邮票关联节拍',
        actIndex: 1,
        deadlineAct: 1,
        required: true,
        claimedIn: null,
        provenByEventIds: [],
      },
    },
  }
}

function memoryWithDueForeshadows(count: number): StoryMemory {
  const memory = createEmptyStoryMemory()
  for (let index = 0; index < count; index++) {
    const id = `fs-${String(index).padStart(2, '0')}`
    memory.foreshadows[id] = {
      id,
      text: id,
      kind: 'plot',
      introducedIn: 0,
      expectedFulfillChapter: 5,
      fulfilledIn: null,
      resolutionPolicy: 'must_resolve',
      required: true,
      beatId: null,
    }
  }
  return memory
}

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
    expect(isClosingPhase(20, 16, 0.15)).toBe(true)
    expect(isClosingPhase(20, 15, 0.15)).toBe(false)
    expect(isClosingPhase(20, 16, 0.2)).toBe(true)
    expect(isClosingPhase(20, 15, 0.2)).toBe(true)
    expect(isClosingPhase(20, 14, 0.2)).toBe(false)
  })

  it('builds arc status with current act and pending beats', () => {
    const storyArc = makeStoryArc()
    const actProgress = {
      1: { consumed: ['主角失去庇护'], pending: ['反派首次施压'] },
    }
    const status = buildArcStatus(storyArc, actProgress, 1, 0.15, new Set())

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
    const status = buildArcStatus(storyArc, actProgress, 3, 0.15, new Set())

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
    const status = buildArcStatus(storyArc, actProgress, 10, 0.15, new Set())

    expect(status.overdueKeyBeats).toHaveLength(1)
    expect(status.overdueKeyBeats[0]?.beat).toBe('核心秘密被主角获悉')
    expect(status.riskLevel).toBe('high')
  })

  it('does not propose extension when pending beats fit current and remaining chapter capacity', () => {
    const storyArc = makeStoryArc()
    const actProgress = {
      1: { consumed: [], pending: ['主角失去庇护', '反派首次施压'] },
    }
    const proposals = proposeActBoundaryAdjustments(storyArc, actProgress, 3)

    expect(proposals).toHaveLength(0)
  })

  it('proposes extension when pending beats exceed current and remaining chapter capacity', () => {
    const storyArc: StoryArc = {
      totalChapters: 8,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 5,
          title: '入局',
          theme: '卷入',
          function: '建立',
          mandatoryBeats: ['beat1', 'beat2', 'beat3', 'beat4', 'beat5'],
        },
      ],
      keyBeats: [],
    }
    const actProgress = {
      1: { consumed: [], pending: ['beat1', 'beat2', 'beat3', 'beat4', 'beat5'] },
    }
    const proposals = proposeActBoundaryAdjustments(storyArc, actProgress, 3)

    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.actIndex).toBe(1)
    expect(proposals[0]?.proposedEndChapter).toBeGreaterThan(5)
  })

  it('extends a one-chapter boundary by three chapters for eleven due clues at capacity three', () => {
    const proposals = proposeActBoundaryAdjustments(
      makeStoryArc(),
      completedActProgress,
      4,
      memoryWithDueForeshadows(11),
      3
    )

    expect(proposals).toEqual([expect.objectContaining({ actIndex: 1, proposedEndChapter: 8 })])
    expect(proposals[0]?.reason).toContain('11 个 required')
    expect(proposals[0]?.reason).toContain('1 个章节槽位')
    expect(proposals[0]?.reason).toContain('每章 3 个')
  })

  it('extends the act when a boundary chapter defers all due foreshadows', () => {
    const proposal = proposeActExtensionAfterForeshadowAdjudication(
      makeStoryArc(),
      4,
      memoryWithDueForeshadows(3),
      3,
      []
    )

    expect(proposal).toEqual(expect.objectContaining({ actIndex: 1, proposedEndChapter: 6 }))
    expect(proposal?.reason).toContain('本章裁决后仍有 3 个 required 未回收伏笔')
    expect(proposal?.reason).toContain('未来 0 个章节槽位')
  })

  it('does not reserve future capacity for foreshadows planned in the current chapter', () => {
    const proposal = proposeActExtensionAfterForeshadowAdjudication(
      makeStoryArc(),
      4,
      memoryWithDueForeshadows(3),
      3,
      ['fs-00', 'fs-01', 'fs-02']
    )

    expect(proposal).toBeUndefined()
  })

  it('recalculates remaining capacity when post-adjudication extension crosses a deadline', () => {
    const memory = memoryWithDueForeshadows(4)
    for (let index = 0; index < 4; index++) {
      const id = `future-${index}`
      memory.foreshadows[id] = {
        id,
        text: id,
        kind: 'plot',
        introducedIn: 0,
        expectedFulfillChapter: 6,
        fulfilledIn: null,
        resolutionPolicy: 'must_resolve',
        required: true,
        beatId: null,
      }
    }

    const proposal = proposeActExtensionAfterForeshadowAdjudication(
      makeStoryArc(),
      4,
      memory,
      3,
      []
    )

    expect(proposal?.proposedEndChapter).toBe(8)
  })

  it('extends for foreshadow capacity even when the current chapter is far from the boundary', () => {
    const arc: StoryArc = {
      totalChapters: 10,
      acts: [{ ...makeStoryArc().acts[0]!, endChapter: 10 }],
      keyBeats: [],
    }
    const proposals = proposeActBoundaryAdjustments(
      arc,
      completedActProgress,
      4,
      memoryWithDueForeshadows(20),
      3
    )

    expect(proposals).toEqual([expect.objectContaining({ proposedEndChapter: 11 })])
  })

  it('uses the greater of beat and foreshadow extension instead of adding them', () => {
    const arc: StoryArc = {
      totalChapters: 5,
      acts: [{ ...makeStoryArc().acts[0]!, endChapter: 5, mandatoryBeats: ['a', 'b', 'c'] }],
      keyBeats: [],
    }
    const proposals = proposeActBoundaryAdjustments(
      arc,
      { 1: { consumed: [], pending: ['a', 'b', 'c'] } },
      4,
      memoryWithDueForeshadows(7),
      3
    )

    expect(proposals).toEqual([expect.objectContaining({ proposedEndChapter: 7 })])
    expect(proposals[0]?.reason).toContain('3 个 mandatory beats')
    expect(proposals[0]?.reason).toContain('7 个 required')
  })

  it('recalculates capacity when an extension crosses another explicit deadline', () => {
    const memory = memoryWithDueForeshadows(4)
    for (let index = 0; index < 4; index++) {
      const id = `future-${index}`
      memory.foreshadows[id] = {
        id,
        text: id,
        kind: 'plot',
        introducedIn: 0,
        expectedFulfillChapter: 6,
        fulfilledIn: null,
        resolutionPolicy: 'must_resolve',
        required: true,
        beatId: null,
      }
    }

    const proposals = proposeActBoundaryAdjustments(
      makeStoryArc(),
      completedActProgress,
      4,
      memory,
      3
    )

    expect(proposals[0]?.proposedEndChapter).toBe(7)
  })

  it('includes future finite obligations but excludes null-deadline clues from final-act capacity', () => {
    const memory = memoryWithDueForeshadows(1)
    memory.foreshadows.future = {
      ...memory.foreshadows['fs-00']!,
      id: 'future',
      text: 'future',
      expectedFulfillChapter: 30,
    }
    memory.foreshadows.unscheduled = {
      ...memory.foreshadows['fs-00']!,
      id: 'unscheduled',
      text: 'unscheduled',
      expectedFulfillChapter: null,
      resolutionPolicy: 'should_resolve',
    }

    const proposals = proposeActBoundaryAdjustments(
      makeStoryArc(),
      { 4: { consumed: ['最终对决'], pending: [] } },
      19,
      memory,
      1
    )

    expect(proposals).toEqual([expect.objectContaining({ actIndex: 4, proposedEndChapter: 21 })])
  })

  it('fails explicitly when a corrupt act boundary is not a safe integer', () => {
    const storyArc = makeStoryArc()
    storyArc.acts[0] = {
      ...storyArc.acts[0]!,
      endChapter: Number.MAX_SAFE_INTEGER + 1,
    }

    expect(() =>
      proposeActBoundaryAdjustments(
        storyArc,
        completedActProgress,
        4,
        memoryWithDueForeshadows(1),
        3
      )
    ).toThrowError('安全整数')
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

  it('does not reduce past a required deadline due by the candidate end', () => {
    const proposals = proposeActBoundaryAdjustments(
      makeStoryArc(),
      completedActProgress,
      3,
      memoryWithForeshadow({ expectedFulfillChapter: 4 })
    )

    expect(proposals).toHaveLength(0)
  })

  it('may reduce when a clue is due after the candidate end', () => {
    const proposals = proposeActBoundaryAdjustments(
      makeStoryArc(),
      completedActProgress,
      3,
      memoryWithForeshadow({ expectedFulfillChapter: 5 })
    )

    expect(proposals).toEqual([expect.objectContaining({ proposedEndChapter: 4 })])
  })

  it('keeps the final act open so future must-resolve foreshadows remain schedulable', () => {
    const proposals = proposeActBoundaryAdjustments(
      makeStoryArc(),
      { 4: { consumed: ['最终对决'], pending: [] } },
      18,
      memoryWithForeshadow({ expectedFulfillChapter: 20 })
    )

    expect(proposals).toEqual([])
  })

  it('allows shortening the final act when no must-resolve foreshadows remain', () => {
    const proposals = proposeActBoundaryAdjustments(
      makeStoryArc(),
      { 4: { consumed: ['最终对决'], pending: [] } },
      18
    )

    expect(proposals).toEqual([expect.objectContaining({ actIndex: 4, proposedEndChapter: 19 })])
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
    const constraint = buildClosingPhaseConstraint(storyArc, actProgress, 17, 0.15, new Set())

    expect(constraint).toContain('全书收尾阶段')
    expect(constraint).toContain('禁止引入新的主要支线')
    expect(constraint).toContain('最终对决')
  })

  it('returns undefined when not in closing phase', () => {
    const storyArc = makeStoryArc()
    const constraint = buildClosingPhaseConstraint(storyArc, {}, 5, 0.15, new Set())

    expect(constraint).toBeUndefined()
  })

  describe('applyActBoundaryAdjustment', () => {
    it('uses the configured automatic extension limits', () => {
      const storyArc = makeStoryArc()
      const proposal = { actIndex: 1, proposedEndChapter: 7, reason: 'test' }
      const result = applyActBoundaryAdjustment(storyArc, proposal, 3, {
        ...DEFAULT_CHAPTER_PLANNING_CONFIG,
        actBoundaryAutoAdjustmentMaxChapters: 1,
        actBoundaryAutoAdjustmentMaxCumulativeChapters: 1,
        actBoundaryAutoAdjustmentMaxGlobalRatio: 0.05,
      })

      expect(result.applied).toBe(false)
      expect(result.availableExtensions).toBe(1)
    })

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

    it('shrinks the story boundary when shortening the final act', () => {
      const storyArc = makeStoryArc()
      const proposal = { actIndex: 4, proposedEndChapter: 19, reason: 'test' }
      const result = applyActBoundaryAdjustment(storyArc, proposal, 18)

      expect(result.applied).toBe(true)
      expect(result.storyArc.acts.at(-1)?.endChapter).toBe(19)
      expect(result.storyArc.totalChapters).toBe(19)
    })

    it('rejects an extension beyond the automatic limit without partially applying it', () => {
      const storyArc = makeStoryArc()
      const proposal = { actIndex: 1, proposedEndChapter: 10, reason: 'test' }
      const result = applyActBoundaryAdjustment(storyArc, proposal, 3)

      expect(result.applied).toBe(false)
      expect(result.requiresManualResolution).toBe(true)
      expect(result.storyArc).toEqual(storyArc)
      expect(result.reason).toContain('请求延长 5 章')
      expect(result.reason).toContain('可用自动延长额度仅 3 章')
    })

    it('does not shift following acts when the requested extension exceeds the limit', () => {
      const storyArc = makeStoryArc()
      const proposal = { actIndex: 1, proposedEndChapter: 10, reason: 'test' }
      const result = applyActBoundaryAdjustment(storyArc, proposal, 3)

      expect(result.applied).toBe(false)
      expect(result.storyArc.acts.map((act) => act.endChapter - act.startChapter + 1)).toEqual([
        5, 5, 5, 5,
      ])
    })

    it('rejects a capacity proposal that exceeds automatic limits instead of under-sizing it', () => {
      const storyArc = makeStoryArc()
      const proposal = proposeActBoundaryAdjustments(
        storyArc,
        completedActProgress,
        4,
        memoryWithDueForeshadows(14),
        3
      )[0]!

      expect(proposal.proposedEndChapter).toBe(9)

      const result = applyActBoundaryAdjustment(storyArc, proposal, 4)

      expect(result.applied).toBe(false)
      expect(result.requiresManualResolution).toBe(true)
      expect(result.storyArc).toEqual(storyArc)
      expect(result.reason).toContain('请求延长 4 章')
      expect(result.reason).toContain('可用自动延长额度仅 3 章')
      expect(result.reason).toContain(proposal.reason)
      expect(result.reason).not.toContain('pending beats')
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

  describe('calculateBeatBudget', () => {
    it('caps first chapter to at most 2 beats', () => {
      const act: ActArc = {
        index: 1,
        startChapter: 1,
        endChapter: 9,
        title: '入局',
        theme: '卷入',
        function: '建立',
        mandatoryBeats: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      }
      expect(calculateBeatBudget(act, 0, ['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe(2)
    })

    it('distributes beats across early chapters without consuming all at once', () => {
      const act: ActArc = {
        index: 1,
        startChapter: 1,
        endChapter: 9,
        title: '入局',
        theme: '卷入',
        function: '建立',
        mandatoryBeats: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      }
      // Chapter 2 (1-based position 2): 7 pending, 8 remaining, avg 0.875, cap ceil(1.31)=2
      expect(calculateBeatBudget(act, 1, ['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe(2)
    })

    it('returns 0 when no pending beats remain', () => {
      const act: ActArc = {
        index: 1,
        startChapter: 1,
        endChapter: 9,
        title: '入局',
        theme: '卷入',
        function: '建立',
        mandatoryBeats: ['a', 'b'],
      }
      expect(calculateBeatBudget(act, 3, [])).toBe(0)
    })

    it('allows consuming all remaining beats in the last chapter', () => {
      const act: ActArc = {
        index: 1,
        startChapter: 1,
        endChapter: 5,
        title: '入局',
        theme: '卷入',
        function: '建立',
        mandatoryBeats: ['a', 'b', 'c'],
      }
      // Chapter 5 (position 5): 3 pending, 1 remaining, avg 3, cap 5 -> min(3,5)=3
      expect(calculateBeatBudget(act, 4, ['a', 'b', 'c'])).toBe(3)
    })

    it('always allows at least 1 beat when there are pending beats', () => {
      const act: ActArc = {
        index: 1,
        startChapter: 1,
        endChapter: 9,
        title: '入局',
        theme: '卷入',
        function: '建立',
        mandatoryBeats: ['a'],
      }
      expect(calculateBeatBudget(act, 1, ['a'])).toBe(1)
    })
  })
})
