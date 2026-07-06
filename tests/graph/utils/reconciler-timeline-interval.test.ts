import { describe, expect, it } from 'vitest'
import {
  buildCharacterFactTimeline,
  filterSupersededFactsFromTimeline,
  filterSupersededEventsFromTimeline,
} from '../../../src/graph/utils/reconciler/timeline.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { CanonicalFact } from '../../../src/types/story-state.js'

function buildState(facts: CanonicalFact[]): ReducedGraphState {
  return {
    story: { id: 's1', title: 'Story', outputDir: '/tmp' },
    idea: 'idea',
    genre: 'default',
    totalChapters: 5,
    world: null,
    characters: [{ name: '主角', aliases: [], description: '', role: 'protagonist', tags: [] }],
    storyArc: null,
    outline: [],
    actProgress: {},
    chapters: [],
    currentChapterIndex: 0,
    foreshadowStack: [],
    timeline: undefined,
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: true,
    writeOneChapterOnly: true,
    lastPrintedChapter: 0,
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
      canonicalFacts: facts,
    },
    verifiedConstraints: [],
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
    blockingReport: null,
  } as unknown as ReducedGraphState
}

describe('buildCharacterFactTimeline interval filtering', () => {
  it('excludes retired facts from later chapter timelines', () => {
    const facts: CanonicalFact[] = [
      {
        id: 'f1',
        subject: '主角',
        attribute: 'location',
        value: '家乡',
        establishedIn: 0,
        confidence: 'high',
        source: 'chapter_text',
      },
      {
        id: 'f2',
        subject: '主角',
        attribute: 'location',
        value: '京城',
        establishedIn: 2,
        retiredIn: 4,
        confidence: 'high',
        source: 'chapter_text',
      },
      {
        id: 'f3',
        subject: '主角',
        attribute: 'location',
        value: '边疆',
        establishedIn: 4,
        confidence: 'high',
        source: 'chapter_text',
      },
    ]

    const state = buildState(facts)

    const chapter2 = buildCharacterFactTimeline(state, 2)
    expect(chapter2).toContain('家乡')
    expect(chapter2).toContain('京城')
    expect(chapter2).not.toContain('边疆')

    const chapter3 = buildCharacterFactTimeline(state, 3)
    expect(chapter3).toContain('京城')
    expect(chapter3).not.toContain('边疆')

    const chapter4 = buildCharacterFactTimeline(state, 4)
    expect(chapter4).not.toContain('京城')
    expect(chapter4).toContain('边疆')
  })
})

describe('filterSupersededFactsFromTimeline', () => {
  it('is a no-op to avoid natural-language matching on summary text', () => {
    const entries = [
      { character: '主角', facts: ['在家乡', '在京城'] },
      { character: '配角', facts: ['在家乡'] },
    ]
    const canonicalFacts: CanonicalFact[] = [
      {
        id: 'f1',
        subject: '主角',
        attribute: 'location',
        value: '边疆',
        establishedIn: 2,
        confidence: 'high',
        source: 'chapter_text',
        supersedes: [{ chapter: 0, oldValue: '京城' }],
      },
    ]
    const filtered = filterSupersededFactsFromTimeline(entries, canonicalFacts)
    expect(filtered).toEqual(entries)
  })
})

describe('filterSupersededEventsFromTimeline', () => {
  it('is a no-op to avoid natural-language matching on summary text', () => {
    const events = ['主角在家乡', '主角在京城', '主角在边疆']
    const canonicalFacts: CanonicalFact[] = [
      {
        id: 'f1',
        subject: '主角',
        attribute: 'location',
        value: '边疆',
        establishedIn: 2,
        confidence: 'high',
        source: 'chapter_text',
        supersedes: [{ chapter: 0, oldValue: '京城' }],
      },
    ]
    const filtered = filterSupersededEventsFromTimeline(events, canonicalFacts)
    expect(filtered).toEqual(events)
  })
})
