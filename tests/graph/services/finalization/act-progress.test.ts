import { describe, expect, it } from 'vitest'
import {
  getActForChapter,
  normalizeVerifiedBeats,
  updateActProgress,
} from '../../../../src/graph/services/finalization/act-progress.js'
import { createEmptyStoryState } from '../../../../src/storage/meta/stores/story-state.js'
import type { ReducedGraphState } from '../../../../src/graph/state.js'

function buildState(overrides: Partial<ReducedGraphState> = {}): ReducedGraphState {
  return {
    story: {
      id: 'story-1',
      title: 'Test',
      idea: 'test',
      genre: 'default',
      totalChapters: 3,
      status: 'writing',
      provider: 'openai',
      outputDir: '/tmp/museflow-test',
      createdAt: 0,
      updatedAt: 0,
    },
    idea: 'test',
    genre: 'default',
    totalChapters: 3,
    world: null,
    characters: [],
    storyArc: {
      totalChapters: 3,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 3,
          title: '启程',
          theme: '出发',
          function: '建立动机',
          mandatoryBeats: ['主角离开家乡', '反派首次施压'],
        },
      ],
      keyBeats: [],
    },
    outline: [
      {
        number: 1,
        title: '启程',
        description: '主角离开家乡。',
        verifiedBeats: ['主角离开家乡'],
      },
      {
        number: 2,
        title: '遇敌',
        description: '反派首次施压。',
        claimedBeats: ['反派首次施压'],
        verifiedBeats: ['反派首次施压'],
      },
      { number: 3, title: '脱困', description: '主角脱困。' },
    ],
    actProgress: {
      1: { consumed: [], pending: ['主角离开家乡', '反派首次施压'] },
      2: { consumed: ['其他幕节拍'], pending: [] },
    },
    chapters: [null, null, null],
    currentChapterIndex: 1,
    foreshadowStack: [],
    timeline: undefined,
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: true,
    lastPrintedChapter: -1,
    lastTimelineSnapshot: null,
    chapterPlan: null,
    storyState: createEmptyStoryState(),
    chapterTimeAnchor: undefined,
    autoFixAttempts: 0,
    verifiedConstraints: [],
    chapterReport: null,
    blockingReport: null,
    session: {
      chapterIndex: 1,
      rewriteAttempts: 0,
      errorRewriteAttempts: 0,
      autoFixAttempts: 0,
      previousIssues: [],
      previousRawErrorCount: 0,
      routingDecision: 'finalize_chapter',
      forceStructuralRewrite: false,
      rewriteApproved: false,
      issueFingerprintHistory: [],
    },
    authorDecisions: {},
    ...overrides,
  }
}

describe('finalization act progress helpers', () => {
  it('finds the act containing a zero-based chapter index', () => {
    const state = buildState()

    expect(getActForChapter(state.storyArc, 0)?.index).toBe(1)
    expect(getActForChapter(state.storyArc, 2)?.index).toBe(1)
    expect(getActForChapter(state.storyArc, 3)).toBeUndefined()
  })

  it('keeps only exact mandatory beat strings', () => {
    expect(
      normalizeVerifiedBeats(
        ['主角离开家乡', '阿明告别故乡，离开家乡', '无关描述'],
        ['主角离开家乡']
      )
    ).toEqual(['主角离开家乡'])
  })

  it('recalculates consumed beats from outline history while preserving other acts', async () => {
    const state = buildState()

    const result = await updateActProgress(state, 1)

    expect(result.actProgress[1]).toEqual({
      consumed: ['主角离开家乡', '反派首次施压'],
      pending: [],
    })
    expect(result.actProgress[2]).toEqual({ consumed: ['其他幕节拍'], pending: [] })
    expect(result.beatVerificationIssues).toEqual([])
  })

  it('reports claimed mandatory beats that the current chapter did not verify', async () => {
    const state = buildState({
      outline: [
        {
          number: 1,
          title: '启程',
          description: '主角离开家乡。',
          verifiedBeats: ['主角离开家乡'],
        },
        {
          number: 2,
          title: '遇敌',
          description: '反派首次施压。',
          claimedBeats: ['反派首次施压'],
          verifiedBeats: [],
        },
        { number: 3, title: '脱困', description: '主角脱困。' },
      ],
    })

    const result = await updateActProgress(state, 1)

    expect(result.beatVerificationIssues).toHaveLength(1)
    expect(result.beatVerificationIssues?.[0]?.type).toBe('outline_coverage')
    expect(result.beatVerificationIssues?.[0]?.description).toContain('反派首次施压')
  })
})
