import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  ConsistencyAgent: class {},
  OutlineComplianceAgent: class {
    async run(state: { outline?: string }) {
      capturedOutline = state.outline ?? ''
      return { success: true, data: { is_compliant: true, event_checks: [], deviations: [] } }
    }

    processOutput() {
      return { issues: [], isCompliant: true }
    }
  },
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

describe('verify_outline_compliance bridge hint', () => {
  beforeEach(() => {
    capturedOutline = ''
    vi.clearAllMocks()
  })

  it('includes generic next-chapter boundary hint in outline', async () => {
    const { verify_outline_compliance } = await import('../../src/graph/nodes.ts')

    await verify_outline_compliance({
      story: { id: 'story-1', title: '测试', outputDir: '/tmp/story' },
      idea: 'test',
      genre: 'default',
      totalChapters: 2,
      world: null,
      characters: [],
      outline: [
        { number: 1, title: '第一章', description: '反派伏法，但后续仍需处理。' },
        { number: 2, title: '第二章', description: '众人继续辨别真相并完成最终处置。' },
      ],
      chapters: [{ id: 'chapter-1', storyId: 'story-1', number: 1, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 }, null],
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
      storyState: null,
    } as never)

    expect(capturedOutline).toContain('【后续章节边界提示】')
    expect(capturedOutline).toContain('不要把后续章节的核心事件提前解决')
  })

  it('does not include bridge hint when no terminal resolution is needed', async () => {
    const { verify_outline_compliance } = await import('../../src/graph/nodes.ts')

    await verify_outline_compliance({
      story: { id: 'story-1', title: '测试', outputDir: '/tmp/story' },
      idea: 'test',
      genre: 'default',
      totalChapters: 2,
      world: null,
      characters: [],
      outline: [
        { number: 1, title: '第一章', description: '主角离开家乡。' },
        { number: 2, title: '第二章', description: '主角遭遇敌人。' },
      ],
      chapters: [{ id: 'chapter-1', storyId: 'story-1', number: 1, title: null, outline: null, summary: null, foreshadows: null, status: 'drafting', createdAt: 0, updatedAt: 0 }, null],
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
      storyState: null,
    } as never)

    expect(capturedOutline).not.toContain('【跨章节大纲桥接】')
    expect(capturedOutline).not.toContain('被制服、受控或暂时收押')
  })
})
