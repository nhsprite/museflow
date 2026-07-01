import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ReducedGraphState } from '../../src/graph/state.js'
import { createMockContext } from '../utils/mock-context.ts'

const testTempDir = join(tmpdir(), `museflow-layered-outline-${randomUUID().slice(0, 8)}`)

const expandOutlineMock = vi.fn()
const runAgentMock = vi.fn()
const storyArcRunMock = vi.fn()

vi.mock('../../src/core/outline-expander.js', () => ({
  expandOutlineForChapter: expandOutlineMock,
}))

vi.mock('../../src/agents/index.js', () => ({
  WorldbuilderAgent: class {},
  CharacterAgent: class {},
  StoryArcAgent: class {
    async run() {
      return storyArcRunMock()
    }
  },
  ChapterOutlineAgent: class {},
  ChapterAgent: class {
    async run() {
      return { content: runAgentMock() }
    }
  },
  ChapterPlannerAgent: class {},
  ForeshadowingAgent: class {},
  ConsistencyAgent: class {},
  FixAgent: class {},
  SummaryAgent: class {},
  processSummaryOutput: vi.fn(),
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  writeChapterContent: vi.fn().mockResolvedValue(undefined),
  readChapterContent: vi.fn().mockResolvedValue(null),
  writeOutlineContent: vi.fn().mockResolvedValue(undefined),
  writeStoryBible: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/storage/meta/stores/chapter.js', () => ({
  saveOutline: vi.fn(),
}))

vi.mock('../../src/genres/registry.js', () => ({
  getGenreSkill: vi.fn().mockReturnValue(null),
}))

const storyArc = {
  totalChapters: 2,
  acts: [
    {
      index: 1,
      startChapter: 1,
      endChapter: 2,
      title: '启程',
      theme: '主角踏上旅程',
      function: '建立主角动机与初始张力',
      mandatoryBeats: ['主角离开家乡'],
    },
  ],
  keyBeats: [],
}

const baseState: ReducedGraphState = {
  story: { id: 'story-1', title: 'Story', outputDir: testTempDir },
  idea: 'idea',
  genre: 'default',
  totalChapters: 2,
  world: null,
  characters: [],
  storyArc,
  outline: [
    { number: 1, title: '', description: '' },
    { number: 2, title: '', description: '' },
  ],
  actProgress: {
    1: { consumed: [], pending: ['主角离开家乡'] },
  },
  chapters: [null, null],
  currentChapterIndex: 0,
  foreshadowStack: [],
  chapterSummaries: [],
  pendingIssues: [],
  rewriteApproved: false,
  rewriteRequested: false,
  isWriting: true,
  writeOneChapterOnly: true,
  lastPrintedChapter: 0,
  lastTimelineSnapshot: null,
  chapterPlan: null,
  storyState: null,
  autoFixAttempts: 0,
}

describe('layered outline flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    expandOutlineMock.mockResolvedValue({
      chapterPlan: { sections: [] },
      boundaryHints: [],
    })
    runAgentMock.mockReturnValue('chapter content ' + '主角走在路上，心中思绪万千。'.repeat(600))
    storyArcRunMock.mockResolvedValue({
      success: true,
      data: storyArc,
    })
  })

  it('calls expandOutlineForChapter before drafting', async () => {
    const { draft_chapter } = await import('../../src/graph/nodes/draft.js')

    await draft_chapter(createMockContext(), baseState)

    expect(expandOutlineMock).toHaveBeenCalledWith(baseState, 0, expect.any(Object))
  })

  describe('create_outline', () => {
    it('uses StoryArcAgent to generate story arc', async () => {
      const { create_outline } = await import('../../src/graph/nodes/story-creation.js')

      const result = await create_outline(createMockContext(), baseState)

      expect(storyArcRunMock).toHaveBeenCalledTimes(1)
      expect(result.storyArc).toBeDefined()
      expect(result.storyArc?.acts).toHaveLength(1)
      expect(result.outline).toHaveLength(2)
      expect(result.outline![0]!.title).toBe('')
      expect(result.outline![0]!.description).toBe('')
    })
  })
})
