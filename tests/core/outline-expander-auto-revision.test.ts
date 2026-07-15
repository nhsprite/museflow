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
const { prepareStoryStateForChapterMock } = vi.hoisted(() => ({
  prepareStoryStateForChapterMock: vi.fn(),
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
    run: vi.fn(async (state: { chapterIndex?: number }) =>
      chapterOutlineRunMock(state.chapterIndex ?? 0)
    ),
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

function createJitState(): ReducedGraphState {
  return {
    ...baseState,
    outline: baseState.outline.map((item, index) =>
      index === 1 ? { ...item, title: '', description: '' } : { ...item }
    ),
  }
}

describe('expandOutlineForChapter auto-revision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    planChapterWithOverrideMock.mockReset()
    chapterOutlineRunMock.mockReset()
    prepareStoryStateForChapterMock.mockReset()
    mockChat.mockReset()
    mockChatStructured.mockReset()
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
  })

  it('does not silently rewrite a persisted outline and exposes a validated proposal', async () => {
    const conflict = createConflict()
    const proposal = {
      revisedDescription: '修订后的描述，不再违反约束。',
      explanation: '解释',
    }

    prepareStoryStateForChapterMock
      .mockRejectedValueOnce(new BlockingConflictError([conflict], 1, proposal))
      .mockResolvedValueOnce({
        reconciledState: {},
        stateConflicts: '',
        itemLocationConflicts: [],
      })

    await expect(expandOutlineForChapter(baseState, 1, createMockProvider())).rejects.toMatchObject(
      {
        conflicts: [conflict],
        proposal,
      }
    )
    expect(prepareStoryStateForChapterMock).toHaveBeenCalledTimes(2)
    expect(prepareStoryStateForChapterMock.mock.calls[1]?.[3]).toEqual({
      proposalMode: 'omit',
    })
    expect(planChapterWithOverrideMock).not.toHaveBeenCalled()
  })

  it('does not expose a persisted-outline proposal that still conflicts', async () => {
    const conflict = createConflict()
    const proposal = {
      revisedDescription: '仍然冲突的描述。',
      explanation: '解释',
    }

    prepareStoryStateForChapterMock
      .mockRejectedValueOnce(new BlockingConflictError([conflict], 1, proposal))
      .mockRejectedValueOnce(new BlockingConflictError([conflict], 1))

    await expect(expandOutlineForChapter(baseState, 1, createMockProvider())).rejects.toMatchObject(
      {
        conflicts: [conflict],
        proposal: undefined,
      }
    )
    expect(prepareStoryStateForChapterMock).toHaveBeenCalledTimes(2)
  })

  it('discards a conflicting JIT candidate and succeeds with an independent candidate', async () => {
    chapterOutlineRunMock
      .mockResolvedValueOnce({
        success: true,
        data: { title: '候选一', description: '冲突候选。' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { title: '候选二', description: '有效候选。' },
      })
    prepareStoryStateForChapterMock
      .mockRejectedValueOnce(new BlockingConflictError([createConflict()], 1))
      .mockResolvedValueOnce({
        reconciledState: {},
        stateConflicts: '',
        itemLocationConflicts: [],
      })

    const result = await expandOutlineForChapter(createJitState(), 1, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(2)
    expect(result.outline?.[1]?.description).toBe('有效候选。')
  })

  it('uses a validated revision of a JIT candidate without regenerating', async () => {
    const proposal = {
      revisedDescription: '有效修订。',
      explanation: '解释',
    }
    prepareStoryStateForChapterMock
      .mockRejectedValueOnce(new BlockingConflictError([createConflict()], 1, proposal))
      .mockResolvedValueOnce({
        reconciledState: {},
        stateConflicts: '',
        itemLocationConflicts: [],
      })

    const result = await expandOutlineForChapter(createJitState(), 1, createMockProvider())

    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(1)
    expect(result.outline?.[1]?.description).toBe('有效修订。')
    expect(prepareStoryStateForChapterMock.mock.calls[1]?.[3]).toEqual({
      proposalMode: 'omit',
    })
  })

  it('escalates when every independent JIT candidate has the same structured conflict', async () => {
    const conflict = createConflict()
    prepareStoryStateForChapterMock.mockRejectedValue(new BlockingConflictError([conflict], 1))

    await expect(
      expandOutlineForChapter(createJitState(), 1, createMockProvider())
    ).rejects.toBeInstanceOf(BlockingConflictError)
    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(3)
  })

  it('does not request author resolution when exhausted JIT conflicts are unstable', async () => {
    const conflict1 = createConflict({ subject: '角色一', newValue: '位置一' })
    const conflict2 = createConflict({ subject: '角色二', newValue: '位置二' })
    const conflict3 = createConflict({ subject: '角色三', newValue: '位置三' })
    prepareStoryStateForChapterMock
      .mockRejectedValueOnce(new BlockingConflictError([conflict1], 1))
      .mockRejectedValueOnce(new BlockingConflictError([conflict2], 1))
      .mockRejectedValueOnce(new BlockingConflictError([conflict3], 1))

    let caught: unknown
    try {
      await expandOutlineForChapter(createJitState(), 1, createMockProvider())
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(Error)
    expect(caught).not.toBeInstanceOf(BlockingConflictError)
    expect((caught as Error).message).toContain('临时大纲候选')
    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(3)
  })

  it('compares structured conflicts independently of conflict order', async () => {
    const conflict1 = createConflict({ subject: '角色一', newValue: '位置一' })
    const conflict2 = createConflict({ subject: '角色二', newValue: '位置二' })
    prepareStoryStateForChapterMock
      .mockRejectedValueOnce(new BlockingConflictError([conflict1, conflict2], 1))
      .mockRejectedValueOnce(new BlockingConflictError([conflict2, conflict1], 1))
      .mockRejectedValueOnce(new BlockingConflictError([conflict1, conflict2], 1))

    await expect(
      expandOutlineForChapter(createJitState(), 1, createMockProvider())
    ).rejects.toBeInstanceOf(BlockingConflictError)
    expect(chapterOutlineRunMock).toHaveBeenCalledTimes(3)
  })
})
