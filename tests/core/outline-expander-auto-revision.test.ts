import { describe, expect, it, vi, beforeEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expandOutlineForChapter } from '../../src/core/outline-expander.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import type { ModelProvider } from '../../src/model/provider.js'
import { BlockingConflictError } from '../../src/utils/errors.js'
import type { Conflict } from '../../src/types/story-state.js'

const testTempDir = join(tmpdir(), `museflow-outline-expander-ar-${randomUUID().slice(0, 8)}`)

const { planChapterWithOverrideMock } = vi.hoisted(() => ({
  planChapterWithOverrideMock: vi.fn(),
}))

const mockChat = vi.fn(async (): Promise<string> => '')
const mockChatStructured = vi.fn()
const chapterOutlineRunMock = vi.fn()
const { prepareStoryStateForChapterMock, generateOutlineRevisionProposalMock } = vi.hoisted(() => ({
  prepareStoryStateForChapterMock: vi.fn(),
  generateOutlineRevisionProposalMock: vi.fn(),
}))

function createMockProvider(): ModelProvider {
  return {
    chat: mockChat,
    chatStructured: mockChatStructured,
  }
}

vi.mock('../../src/graph/nodes/planning.js', () => ({
  plan_chapter_with_override: planChapterWithOverrideMock,
}))

vi.mock('../../src/graph/agent-factory.js', () => ({
  getChapterOutlineAgent: () => ({
    run: vi.fn(async (state: { chapterIndex?: number }) => chapterOutlineRunMock(state.chapterIndex ?? 0)),
  }),
}))

vi.mock('../../src/utils/context-judge.js', () => ({
  batchValidateTimeAnchors: vi.fn().mockResolvedValue([{ valid: true }]),
}))

vi.mock('../../src/storage/filesystem/writer.js', () => ({
  writeOutlineContent: vi.fn().mockResolvedValue(undefined),
  readChapterContent: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../src/graph/utils/reconciler/index.js', () => ({
  formatStoryState: vi.fn(() => 'mocked story state'),
  prepareStoryStateForChapter: prepareStoryStateForChapterMock,
}))

vi.mock('../../src/core/chapter-generation/outline-revision-proposal.js', () => ({
  generateOutlineRevisionProposal: generateOutlineRevisionProposalMock,
}))

const storyArc = {
  totalChapters: 3,
  acts: [
    {
      index: 1,
      startChapter: 1,
      endChapter: 3,
      title: '第一幕',
      theme: '测试主题',
      function: '测试功能',
      mandatoryBeats: ['主角离开家乡'],
    },
  ],
  keyBeats: [],
}

const baseState: ReducedGraphState = {
  story: { id: 'story-1', title: 'Story', outputDir: testTempDir },
  idea: 'idea',
  genre: 'default',
  totalChapters: 3,
  world: null,
  characters: [],
  storyArc,
  outline: [
    { number: 1, title: '启程', description: '主角离开家乡。' },
    { number: 2, title: '遇敌', description: '主角遭遇敌人并暂时被困。' },
    { number: 3, title: '脱困', description: '主角脱困并反击。' },
  ],
  actProgress: { 1: { consumed: [], pending: ['主角离开家乡'] } },
  chapters: [null, null, null],
  currentChapterIndex: 1,
  foreshadowStack: [],
  chapterSummaries: ['第一章摘要'],
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

function createConflict(overrides?: Partial<Conflict>): Conflict {
  return {
    id: 'test-conflict',
    type: 'contradiction',
    subject: '主角',
    attribute: '状态',
    oldValue: '留在村里',
    newValue: '离开村子',
    outlineReference: '大纲描述',
    severity: 'blocking',
    description: '测试冲突',
    ...overrides,
  }
}

describe('expandOutlineForChapter auto-revision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    planChapterWithOverrideMock.mockResolvedValue({ chapterPlan: { sections: [] } })
    mockChatStructured.mockResolvedValue({ results: [true, true] })
    mockChat.mockResolvedValue(JSON.stringify({ results: [true, true] }))
    chapterOutlineRunMock.mockResolvedValue({
      success: true,
      data: {
        title: '即时标题',
        description: '即时生成的描述。',
        introducedCharacters: [],
        claimedBeats: [],
      },
    })
    prepareStoryStateForChapterMock.mockResolvedValue({
      reconciledState: {},
      stateConflicts: '',
      itemLocationConflicts: [],
    })
    generateOutlineRevisionProposalMock.mockResolvedValue(null)
  })

  it('revises outline automatically when first draft has blocking conflicts', async () => {
    const conflict = createConflict()
    const blockingError = new BlockingConflictError([conflict], 1, {
      revisedDescription: '修订后的描述，不再违反约束。',
      explanation: '解释',
    })

    prepareStoryStateForChapterMock
      .mockRejectedValueOnce(blockingError)
      .mockResolvedValueOnce({
        reconciledState: {},
        stateConflicts: '',
        itemLocationConflicts: [],
      })

    generateOutlineRevisionProposalMock.mockResolvedValue({
      revisedDescription: '修订后的描述，不再违反约束。',
      explanation: '解释',
    })

    const result = await expandOutlineForChapter(baseState, 1, createMockProvider())

    expect(prepareStoryStateForChapterMock).toHaveBeenCalledTimes(2)
    expect(generateOutlineRevisionProposalMock).toHaveBeenCalledTimes(1)
    expect(result.outline?.[1]?.description).toBe('修订后的描述，不再违反约束。')
  })

  it('propagates BlockingConflictError when auto-revision repeats the same conflict', async () => {
    const conflict = createConflict()
    const blockingError = new BlockingConflictError([conflict], 1, null)

    prepareStoryStateForChapterMock.mockRejectedValue(blockingError)
    generateOutlineRevisionProposalMock.mockResolvedValue({
      revisedDescription: '仍然冲突的描述。',
      explanation: '解释',
    })

    await expect(expandOutlineForChapter(baseState, 1, createMockProvider())).rejects.toBe(blockingError)
    // 第一次失败后生成修订，第二次检测到冲突集合未变，提前停止
    expect(prepareStoryStateForChapterMock).toHaveBeenCalledTimes(2)
  })

  it('retries up to max attempts when each revision produces a different conflict', async () => {
    const conflict1 = createConflict({
      id: 'conflict-1',
      description: '冲突一',
      subject: '主角',
      newValue: '离开村子',
    })
    const conflict2 = createConflict({
      id: 'conflict-2',
      description: '冲突二',
      subject: '反派',
      newValue: '提前登场',
    })
    const blockingError1 = new BlockingConflictError([conflict1], 1, null)
    const blockingError2 = new BlockingConflictError([conflict2], 1, null)

    prepareStoryStateForChapterMock
      .mockRejectedValueOnce(blockingError1)
      .mockRejectedValueOnce(blockingError2)
      .mockRejectedValue(blockingError2)

    generateOutlineRevisionProposalMock
      .mockResolvedValueOnce({
        revisedDescription: '第一次修订描述。',
        explanation: '解释',
      })
      .mockResolvedValueOnce({
        revisedDescription: '第二次修订描述。',
        explanation: '解释',
      })

    await expect(expandOutlineForChapter(baseState, 1, createMockProvider())).rejects.toBe(blockingError2)
    expect(prepareStoryStateForChapterMock).toHaveBeenCalledTimes(3)
  })

  it('stops retrying when revision proposal is identical to current outline', async () => {
    const conflict = createConflict()
    const blockingError = new BlockingConflictError([conflict], 1, null)

    prepareStoryStateForChapterMock.mockRejectedValue(blockingError)
    generateOutlineRevisionProposalMock.mockResolvedValue({
      revisedDescription: baseState.outline[1]?.description,
      explanation: '解释',
    })

    await expect(expandOutlineForChapter(baseState, 1, createMockProvider())).rejects.toBe(blockingError)
    expect(prepareStoryStateForChapterMock).toHaveBeenCalledTimes(1)
    expect(generateOutlineRevisionProposalMock).toHaveBeenCalledTimes(1)
  })

  it('stops retrying when conflicts do not change between attempts', async () => {
    const conflict = createConflict()
    const blockingError = new BlockingConflictError([conflict], 1, null)

    prepareStoryStateForChapterMock.mockRejectedValue(blockingError)
    generateOutlineRevisionProposalMock.mockResolvedValue({
      revisedDescription: '修订后的描述，仍然触发同一冲突。',
      explanation: '解释',
    })

    await expect(expandOutlineForChapter(baseState, 1, createMockProvider())).rejects.toBe(blockingError)
    expect(prepareStoryStateForChapterMock).toHaveBeenCalledTimes(2)
    expect(generateOutlineRevisionProposalMock).toHaveBeenCalledTimes(1)
  })
})
