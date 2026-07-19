import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.js'

const runOneChapterMock = vi.fn()
const updateStoryRuntimeStatusMock = vi.fn().mockResolvedValue(undefined)
const requireStoryStateMock = vi.fn()

vi.mock('../../src/core/runner.js', () => ({
  updateStoryRuntimeStatus: updateStoryRuntimeStatusMock,
}))

vi.mock('../../src/cli/utils/story-loader.js', () => ({
  requireStoryState: requireStoryStateMock,
}))

vi.mock('../../src/cli/utils/chapter-runner.js', () => ({
  runOneChapterWithConflictResolution: runOneChapterMock,
}))

vi.mock('../../src/cli/utils/chapter-display.js', () => ({
  printActProgress: vi.fn(),
  printIssues: vi.fn(),
}))

vi.mock('../../src/cli/utils/prompt.js', () => ({
  question: vi.fn().mockResolvedValue('n'),
}))

function createCompletedState() {
  return {
    story: {
      id: 'story-1',
      title: 'Test Story',
      idea: 'test',
      genre: 'default',
      totalChapters: 1,
      status: 'writing' as const,
      provider: 'openai' as const,
      outputDir: '/tmp/museflow-continue-test',
      createdAt: 1,
      updatedAt: 1,
    },
    idea: 'test',
    genre: 'default',
    totalChapters: 1,
    world: null,
    characters: [],
    storyArc: {
      totalChapters: 1,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 1,
          title: 'Story',
          theme: '',
          function: '',
          mandatoryBeats: [],
        },
      ],
      keyBeats: [],
    },
    outline: [{ number: 1, title: 'Chapter 1', description: 'Desc 1' }],
    actProgress: {},
    chapters: [null],
    currentChapterIndex: 1,
    foreshadowStack: [],
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: false,
    writeOneChapterOnly: true,
    lastPrintedChapter: 0,
    lastTimelineSnapshot: null,
    storyMemory: createEmptyStoryMemory(),
  }
}

describe('continue command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireStoryStateMock.mockResolvedValue({
      story: createCompletedState().story,
      state: createCompletedState(),
    })
  })

  it('does not invoke the chapter graph when the completed story is at its planned boundary', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { cont } = await import('../../src/cli/commands/continue.ts')

    await cont('story-1', { storyId: 'story-1' })

    expect(runOneChapterMock).not.toHaveBeenCalled()
    expect(updateStoryRuntimeStatusMock).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('[MuseFlow] 故事已完成')
    expect(logSpy).toHaveBeenCalledWith(
      '  可使用 museflow rewrite story-1 --chapter <章节号> 修改已有章节'
    )
    expect(logSpy).toHaveBeenCalledWith('  可使用 museflow export story-1 导出故事')
    logSpy.mockRestore()
  })
})
