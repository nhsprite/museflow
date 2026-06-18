import { beforeEach, describe, expect, it, vi } from 'vitest'

let capturedStoryState = ''
let capturedOutline = ''

vi.mock('../../src/agents/index.js', () => ({
  WorldbuilderAgent: class {},
  CharacterAgent: class {},
  OutlineAgent: class {},
  ChapterAgent: class {},
  ChapterPlannerAgent: class {},
  QualityAgent: class {},
  ForeshadowingAgent: class {},
  HallucinationAgent: class {},
  ConsistencyAgent: class {
    async run(state: { storyState?: string; outline?: string }) {
      capturedStoryState = state.storyState ?? ''
      capturedOutline = state.outline ?? ''
      return { success: true, data: { is_consistent: true, issues: [] } }
    }

    processOutput() {
      return []
    }
  },
  OutlineComplianceAgent: class {},
  FixAgent: class {},
  SummaryAgent: class {},
  processSummaryOutput: vi.fn(),
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  readChapterContent: vi.fn().mockResolvedValue('正文内容'),
  writeChapterContent: vi.fn().mockResolvedValue(undefined),
  writeOutlineContent: vi.fn(),
  writeStoryBible: vi.fn(),
}))

describe('detect_consistency validation context', () => {
  beforeEach(() => {
    capturedStoryState = ''
    capturedOutline = ''
    vi.clearAllMocks()
  })

  it('passes authoritative story state instead of only the reconciled state', async () => {
    const { detect_consistency } = await import('../../src/graph/nodes.ts')

    await detect_consistency({
      story: { id: 'story-1', title: '测试', outputDir: '/tmp/story' },
      idea: 'test',
      genre: 'default',
      totalChapters: 3,
      world: null,
      characters: [
        {
          id: 'character-1',
          storyId: 'story-1',
          name: '林黛玉',
          description: null,
          dialogueStyle: null,
          createdAt: 0,
        },
      ],
      outline: [
        { number: 1, title: '第一章', description: '林黛玉辨认真伪，识破假宝玉。' },
        { number: 2, title: '第二章', description: '后续。' },
        { number: 3, title: '第三章', description: '结局。' },
      ],
      chapters: [{ id: 'chapter-1', storyId: 'story-1', number: 1, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 }, null, null],
      currentChapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
      pendingIssues: [],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: -1,
      lastTimelineSnapshot: null,
      chapterPlan: null,
      storyState: {
        characterLocations: {
          林黛玉: '昆仑山脚',
        },
        characterStatus: {},
        keyItemsLocation: {},
        activePlots: [],
        revealedSecrets: [],
        currentScene: '山路',
        storyTime: '当夜',
      },
      autoFixAttempts: 0,
    })

    expect(capturedStoryState).toContain('昆仑山脚')
  })

  it('redacts future chapter descriptions from consistency outline context', async () => {
    const { detect_consistency } = await import('../../src/graph/nodes.ts')

    await detect_consistency({
      story: { id: 'story-1', title: '测试', outputDir: '/tmp/story' },
      idea: 'test',
      genre: 'default',
      totalChapters: 5,
      world: null,
      characters: [
        {
          id: 'character-1',
          storyId: 'story-1',
          name: '林黛玉',
          description: null,
          dialogueStyle: null,
          createdAt: 0,
        },
      ],
      outline: [
        { number: 1, title: '第一章', description: '黛玉启程。' },
        { number: 2, title: '第二章', description: '途中遇险。' },
        { number: 3, title: '第三章', description: '真相揭露。' },
        { number: 4, title: '第四章', description: '未来转折。' },
        { number: 5, title: '第五章', description: '结局。' },
      ],
      chapters: [
        { id: 'chapter-1', storyId: 'story-1', number: 1, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 },
        { id: 'chapter-2', storyId: 'story-1', number: 2, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 },
        null,
        null,
        null,
      ],
      currentChapterIndex: 1,
      foreshadowStack: [],
      chapterSummaries: [],
      pendingIssues: [],
      rewriteApproved: false,
      rewriteRequested: false,
      isWriting: true,
      writeOneChapterOnly: true,
      lastPrintedChapter: -1,
      lastTimelineSnapshot: null,
      chapterPlan: null,
      storyState: {
        characterLocations: {},
        characterStatus: {},
        keyItemsLocation: {},
        activePlots: [],
        revealedSecrets: [],
        currentScene: '',
        storyTime: '',
      },
      autoFixAttempts: 0,
    })

    expect(capturedOutline).toContain('第一章')
    expect(capturedOutline).toContain('黛玉启程')
    expect(capturedOutline).toContain('第二章')
    expect(capturedOutline).toContain('途中遇险')
    expect(capturedOutline).toContain('第三章')
    expect(capturedOutline).not.toContain('真相揭露')
    expect(capturedOutline).toContain('后续章节内容已隐藏')
    expect(capturedOutline).not.toContain('未来转折')
    expect(capturedOutline).not.toContain('结局')
  })
})
