import { describe, expect, it, vi } from 'vitest'
import type { ReducedGraphState } from '../../src/graph/state.js'

const expandOutlineMock = vi.fn()
const runAgentMock = vi.fn()

vi.mock('../../src/core/outline-expander.js', () => ({
  expandOutlineForChapter: expandOutlineMock,
}))

vi.mock('../../src/agents/index.js', () => ({
  WorldbuilderAgent: class {},
  CharacterAgent: class {},
  OutlineAgent: class {},
  HighLevelOutlineAgent: class {},
  ChapterAgent: class {
    async run() {
      return { content: runAgentMock() }
    }
  },
  ChapterPlannerAgent: class {},
  QualityAgent: class {},
  ForeshadowingAgent: class {},
  HallucinationAgent: class {},
  ConsistencyAgent: class {},
  OutlineComplianceAgent: class {},
  FixAgent: class {},
  SummaryAgent: class {},
  processSummaryOutput: vi.fn(),
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  writeChapterContent: vi.fn().mockResolvedValue(undefined),
  readChapterContent: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../src/genres/registry.js', () => ({
  getGenreSkill: vi.fn().mockReturnValue(null),
}))

const baseState: ReducedGraphState = {
  story: { id: 'story-1', title: 'Story', outputDir: '/tmp/story' },
  idea: 'idea',
  genre: 'default',
  totalChapters: 2,
  world: null,
  characters: [],
  outline: [
    { number: 1, title: '启程', description: '主角离开家乡。' },
    { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
  ],
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
    runAgentMock.mockReturnValue('chapter content')
  })

  it('calls expandOutlineForChapter before drafting', async () => {
    const { draft_chapter } = await import('../../src/graph/nodes.js')

    await draft_chapter(baseState)

    expect(expandOutlineMock).toHaveBeenCalledWith(baseState, 0)
  })
})
