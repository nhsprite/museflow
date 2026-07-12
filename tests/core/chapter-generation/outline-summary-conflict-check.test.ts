import { describe, expect, it, vi, beforeEach } from 'vitest'
import { checkOutlineAgainstPastSummaries } from '../../../src/core/chapter-generation/outline-summary-conflict-check.js'
import type { ModelProvider } from '../../../src/model/provider.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { ChapterOutline } from '../../../src/types/outline.js'
import type { ChapterMeta } from '../../../src/types/chapter.js'

function createMockProvider(chat: ModelProvider['chat']): ModelProvider {
  return { chat, chatStructured: vi.fn().mockResolvedValue({}) }
}

function makeState(options: {
  outline: ChapterOutline[]
  chapters: (ChapterMeta | null)[]
}): ReducedGraphState {
  return {
    story: {
      id: 'test',
      title: 'Test',
      genre: 'default',
      totalChapters: 10,
    } as ReducedGraphState['story'],
    idea: 'test idea',
    genre: 'default',
    totalChapters: 10,
    world: null,
    characters: [],
    storyArc: null,
    outline: options.outline,
    actProgress: {},
    chapters: options.chapters,
    currentChapterIndex: 0,
    foreshadowStack: [],
    timeline: undefined,
    chapterSummaries: undefined,
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: false,
    writeOneChapterOnly: false,
    lastPrintedChapter: -1,
    lastTimelineSnapshot: null,
    chapterPlan: null,
    storyState: {
      characterLocations: {},
      characterStatus: {},
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    },
    chapterTimeAnchor: undefined,
    autoFixAttempts: 0,
    verifiedConstraints: [],
    chapterReport: null,
    blockingReport: null,
    session: {
      chapterIndex: 0,
      rewriteAttempts: 0,
      errorRewriteAttempts: 0,
      autoFixAttempts: 0,
      previousIssues: [],
      previousRawErrorCount: 0,
      routingDecision: undefined,
      forceStructuralRewrite: false,
      rewriteApproved: false,
      issueFingerprintHistory: [],
    },
    authorDecisions: {},
    storyMemory: null,
    draftChapterEvents: undefined,
    chapterFinalStateDeclarations: undefined,
    canonicalFactsDelta: undefined,
    supersededFactsDelta: undefined,
    structuredValidationResult: undefined,
  }
}

function makeChapter(number: number, summary: string): ChapterMeta {
  return {
    id: `ch-${number}`,
    storyId: 'test',
    number,
    title: null,
    outline: '',
    summary,
    foreshadows: null,
    status: 'drafting',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('checkOutlineAgainstPastSummaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array for the first chapter', async () => {
    const state = makeState({
      outline: [{ number: 1, title: 'Start', description: '主角出发。' }],
      chapters: [null],
    })
    const provider = createMockProvider(vi.fn())

    const result = await checkOutlineAgainstPastSummaries(state, 0, provider)
    expect(result).toEqual([])
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('returns empty array when the outline is missing', async () => {
    const state = makeState({
      outline: [{ number: 1, title: '', description: '' }],
      chapters: [makeChapter(1, '主角已经离开家。')],
    })
    const provider = createMockProvider(vi.fn())

    const result = await checkOutlineAgainstPastSummaries(state, 0, provider)
    expect(result).toEqual([])
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('returns empty array when the model reports no conflicts', async () => {
    const state = makeState({
      outline: [
        { number: 1, title: 'Start', description: '主角在家中。' },
        { number: 2, title: 'Departure', description: '主角离开家前往镇上。' },
      ],
      chapters: [makeChapter(1, '主角在家中整理行装。'), null],
    })
    const provider = createMockProvider(
      vi.fn().mockResolvedValue(JSON.stringify({ conflicts: [] }))
    )

    const result = await checkOutlineAgainstPastSummaries(state, 1, provider)
    expect(result).toEqual([])
    expect(provider.chat).toHaveBeenCalledTimes(1)
  })

  it('detects a blocking conflict when the outline repeats a completed physical action', async () => {
    const state = makeState({
      outline: [
        { number: 1, title: 'Mark', description: '主角在记录本右下角写下“甲”字并抹去，留下浅凹。' },
        {
          number: 2,
          title: 'Mark Again',
          description: '主角再次在记录本右下角写下“甲”字并抹去，留下浅凹。',
        },
      ],
      chapters: [makeChapter(1, '主角在记录本右下角写下“甲”字，用指腹抹去，留下浅凹。'), null],
    })
    const provider = createMockProvider(
      vi.fn().mockResolvedValue(
        JSON.stringify({
          conflicts: [
            {
              id: 'c-mark-duplicate',
              type: 'contradiction',
              subject: '主角/记录本',
              attribute: 'event',
              oldValue: '第1章已在记录本右下角写下“甲”字并抹去，留下浅凹',
              newValue: '第2章大纲要求再次写下“甲”字并抹去',
              outlineReference: '主角再次在记录本右下角写下“甲”字并抹去，留下浅凹',
              severity: 'blocking',
              description: '同一浅凹无法由两次独立书写-抹去动作产生',
            },
          ],
        })
      )
    )

    const result = await checkOutlineAgainstPastSummaries(state, 1, provider)
    expect(result).toHaveLength(1)
    expect(result[0]!.severity).toBe('blocking')
    expect(result[0]!.subject).toBe('主角/记录本')
    expect(result[0]!.attribute).toBe('event')
  })

  it('ignores non-blocking warnings', async () => {
    const state = makeState({
      outline: [
        { number: 1, title: 'Home', description: '主角在家中。' },
        { number: 2, title: 'Home Again', description: '主角回到家中。' },
      ],
      chapters: [makeChapter(1, '主角在家中。'), null],
    })
    const provider = createMockProvider(
      vi.fn().mockResolvedValue(
        JSON.stringify({
          conflicts: [
            {
              id: 'c-location',
              type: 'extension',
              subject: '主角',
              attribute: 'location',
              oldValue: '家中',
              newValue: '回到家中',
              outlineReference: '主角回到家中',
              severity: 'warning',
              description: '主角回到家中，但不构成硬冲突',
            },
          ],
        })
      )
    )

    const result = await checkOutlineAgainstPastSummaries(state, 1, provider)
    expect(result).toHaveLength(1)
    expect(result[0]!.severity).toBe('warning')
  })

  it('returns empty array and logs a warning when the model response is invalid', async () => {
    const state = makeState({
      outline: [
        { number: 1, title: 'Home', description: '主角在家中。' },
        { number: 2, title: 'Departure', description: '主角离开家。' },
      ],
      chapters: [makeChapter(1, '主角在家中。'), null],
    })
    const provider = createMockProvider(vi.fn().mockResolvedValue('not valid json'))

    const result = await checkOutlineAgainstPastSummaries(state, 1, provider)
    expect(result).toEqual([])
  })

  it('returns empty array and logs a warning when the model call fails', async () => {
    const state = makeState({
      outline: [
        { number: 1, title: 'Home', description: '主角在家中。' },
        { number: 2, title: 'Departure', description: '主角离开家。' },
      ],
      chapters: [makeChapter(1, '主角在家中。'), null],
    })
    const provider = createMockProvider(vi.fn().mockRejectedValue(new Error('API error')))

    const result = await checkOutlineAgainstPastSummaries(state, 1, provider)
    expect(result).toEqual([])
  })
})
