import { describe, expect, it } from 'vitest'
import { formatActForeshadowBoundaryPressure } from '../../src/cli/formatters/foreshadow-boundary-pressure.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import type { ForeshadowMemory, StoryMemory } from '../../src/types/story-memory.js'
import type { ActArc, StoryArc } from '../../src/types/outline.js'

function act(index: number, startChapter: number, endChapter: number): ActArc {
  return {
    index,
    startChapter,
    endChapter,
    title: `Act ${index}`,
    theme: 'theme',
    function: 'function',
    mandatoryBeats: [],
  }
}

function storyArc(acts: ActArc[]): StoryArc {
  return {
    totalChapters: acts.at(-1)?.endChapter ?? 0,
    acts,
    keyBeats: [],
  }
}

function foreshadow(id: string, expectedFulfillChapter: number | null): ForeshadowMemory {
  const resolutionPolicy =
    expectedFulfillChapter === null ? ('should_resolve' as const) : ('must_resolve' as const)
  return {
    id,
    text: id,
    kind: null,
    introducedIn: 0,
    expectedFulfillChapter,
    fulfilledIn: null,
    resolutionPolicy,
    required: true,
    beatId: null,
  }
}

function stateWithMemory(memory: StoryMemory | null, arc: StoryArc): ReducedGraphState {
  return {
    storyMemory: memory,
    storyArc: arc,
  } as ReducedGraphState
}

describe('formatActForeshadowBoundaryPressure', () => {
  it('formats ordinary-boundary blockers in policy scheduling order', () => {
    const firstAct = act(1, 1, 3)
    const arc = storyArc([firstAct, act(2, 4, 6)])
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        later: foreshadow('fs-later', 4),
        boundary: foreshadow('fs-boundary', 3),
        earlier: foreshadow('fs-earlier', 2),
      },
    }

    expect(
      formatActForeshadowBoundaryPressure(stateWithMemory(memory, arc), firstAct, '  ')
    ).toEqual([
      '  伏笔边界压力: 2 个 must_resolve 硬义务待回收',
      '  必须回收伏笔:',
      '    1. fs-earlier（引入第 1 章，预计第 2 章回收）',
      '    2. fs-boundary（引入第 1 章，预计第 3 章回收）',
    ])
  })

  it('formats null story memory as unavailable pressure', () => {
    const currentAct = act(1, 1, 3)

    expect(
      formatActForeshadowBoundaryPressure(
        stateWithMemory(null, storyArc([currentAct, act(2, 4, 6)])),
        currentAct,
        '  '
      )
    ).toEqual(['  伏笔边界压力: 未知（StoryMemory 不可用）'])
  })

  it('formats empty story memory as zero pressure', () => {
    const currentAct = act(1, 1, 3)

    expect(
      formatActForeshadowBoundaryPressure(
        stateWithMemory(createEmptyStoryMemory(), storyArc([currentAct, act(2, 4, 6)])),
        currentAct,
        '  '
      )
    ).toEqual(['  伏笔边界压力: 0'])
  })

  it('uses story-end semantics for the final act and formats unscheduled deadlines', () => {
    const finalAct = act(2, 4, 6)
    const arc = storyArc([act(1, 1, 3), finalAct])
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        unscheduled: foreshadow('fs-unscheduled', null),
        future: foreshadow('fs-future', 30),
      },
    }

    expect(formatActForeshadowBoundaryPressure(stateWithMemory(memory, arc), finalAct)).toEqual([
      '伏笔边界压力: 1 个 must_resolve 硬义务待回收',
      '必须回收伏笔:',
      '  1. fs-future（引入第 1 章，预计第 30 章回收）',
    ])
  })

  it('never reports soft policies as final-act boundary pressure', () => {
    const finalAct = act(2, 4, 6)
    const arc = storyArc([act(1, 1, 3), finalAct])
    const memory: StoryMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        hard: foreshadow('fs-hard', 6),
        soft: {
          ...foreshadow('fs-soft', null),
          resolutionPolicy: 'should_resolve',
        },
        open: {
          ...foreshadow('fs-open', null),
          resolutionPolicy: 'may_remain_open',
          required: false,
        },
      },
    }

    const output = formatActForeshadowBoundaryPressure(stateWithMemory(memory, arc), finalAct).join(
      '\n'
    )

    expect(output).toContain('1 个 must_resolve')
    expect(output).toContain('fs-hard')
    expect(output).not.toContain('fs-soft')
    expect(output).not.toContain('fs-open')
  })
})
