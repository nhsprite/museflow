import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyChapterReport } from '../../src/types/chapter-report.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import { printActProgress, printChapterReport } from '../../src/cli/utils/chapter-display.js'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'

function buildState(): ReducedGraphState {
  return {
    totalChapters: 10,
    currentChapterIndex: 5,
    storyArc: {
      totalChapters: 10,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 3,
          title: '第一幕',
          theme: '主题一',
          function: '叙事功能一',
          mandatoryBeats: ['节拍一'],
        },
        {
          index: 2,
          startChapter: 4,
          endChapter: 8,
          title: '第二幕',
          theme: '主题二',
          function: '叙事功能二',
          mandatoryBeats: ['节拍二', '节拍三', '节拍四'],
        },
      ],
      keyBeats: [],
    },
    actProgress: {
      2: { consumed: ['节拍二'], pending: ['节拍三', '节拍四'] },
    },
    storyMemory: {
      ...createEmptyStoryMemory(),
      foreshadows: {
        'fs-a': {
          id: 'fs-a',
          text: '伏笔 A',
          kind: null,
          introducedIn: 0,
          expectedFulfillChapter: 6,
          fulfilledIn: null,
          resolutionPolicy: 'must_resolve',
          required: true,
          beatId: null,
        },
        'fs-b': {
          id: 'fs-b',
          text: '伏笔 B',
          kind: null,
          introducedIn: 0,
          expectedFulfillChapter: 8,
          fulfilledIn: null,
          resolutionPolicy: 'must_resolve',
          required: true,
          beatId: null,
        },
      },
    },
  } as ReducedGraphState
}

describe('CLI chapter display', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints current act and beat progress for the target chapter', () => {
    printActProgress(buildState(), 5)

    expect(logSpy).toHaveBeenCalledWith('  当前幕: 第 2/2 幕「第二幕」（第 4-8 章）')
    expect(logSpy).toHaveBeenCalledWith('  幕内进度: 第 3/5 章，剩余 2 章')
    expect(logSpy).toHaveBeenCalledWith('  节拍进度: 1/3 已消费，剩余 2')
    expect(logSpy).toHaveBeenCalledWith('  待消费:')
    expect(logSpy).toHaveBeenCalledWith('    1. 节拍三')
    expect(logSpy).toHaveBeenCalledWith('    2. 节拍四')
    expect(logSpy).toHaveBeenCalledWith('  伏笔边界压力: 2 个 must_resolve 硬义务待回收')
    expect(logSpy).toHaveBeenCalledWith('  必须回收伏笔:')
    expect(logSpy).toHaveBeenCalledWith('    1. fs-a（引入第 1 章，预计第 6 章回收）')
    expect(logSpy).toHaveBeenCalledWith('    2. fs-b（引入第 1 章，预计第 8 章回收）')
  })

  it('prints unavailable foreshadow boundary pressure for legacy state without story memory', () => {
    const state = buildState()
    state.storyMemory = null

    printActProgress(state, 5)

    expect(logSpy).toHaveBeenCalledWith('  伏笔边界压力: 未知（StoryMemory 不可用）')
  })

  it('prints updated act progress in the chapter completion report', () => {
    const report = createEmptyChapterReport('story-1', 5)
    report.chapterTitle = '第6章·风起'
    report.actProgress = {
      actIndex: 2,
      chaptersRemaining: 2,
      beatsTotal: 3,
      beatsConsumed: 1,
      beatsPending: ['节拍三', '节拍四'],
    }

    printChapterReport(report)

    expect(logSpy).toHaveBeenCalledWith(
      '📚 幕进度：第 2 幕，1/3 节拍已消费，剩余 2 个，幕内剩余 2 章'
    )
    expect(logSpy).toHaveBeenCalledWith('   待消费：')
    expect(logSpy).toHaveBeenCalledWith('     1. 节拍三')
    expect(logSpy).toHaveBeenCalledWith('     2. 节拍四')
  })

  it('prints pending required foreshadows in the completion report when state is provided', () => {
    const report = createEmptyChapterReport('story-1', 5)

    printChapterReport(report, buildState())

    expect(logSpy).toHaveBeenCalledWith('   伏笔边界压力: 2 个 must_resolve 硬义务待回收')
    expect(logSpy).toHaveBeenCalledWith('   必须回收伏笔:')
    expect(logSpy).toHaveBeenCalledWith('     1. fs-a（引入第 1 章，预计第 6 章回收）')
    expect(logSpy).toHaveBeenCalledWith('     2. fs-b（引入第 1 章，预计第 8 章回收）')
  })

  it('omits foreshadow boundary pressure in the completion report when state is not provided', () => {
    const report = createEmptyChapterReport('story-1', 5)

    printChapterReport(report)

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('伏笔边界压力'))
  })

  it('prints foreshadows needing manual attention in the completion report', () => {
    const report = createEmptyChapterReport('story-1', 5)
    report.foreshadowsNeedingAttention = ['fs-x']

    printChapterReport(report)

    expect(logSpy).toHaveBeenCalledWith('⚠️  需人工关注的伏笔（deadline 顺延已达上限）：fs-x')
  })
})
