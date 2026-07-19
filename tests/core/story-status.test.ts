import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyCheckpoint } from '@langchain/langgraph-checkpoint'
import { JsonCheckpointer } from '../../src/graph/checkpointer.js'
import { updateStoryStatusInCheckpoint } from '../../src/core/runner.js'
import { createEmptyStoryState } from '../../src/storage/meta/stores/story-state.js'
import type { ReducedGraphState } from '../../src/graph/state.js'
import { STORY_STATUSES } from '../../src/types/story.js'

function makeState(outputDir: string): ReducedGraphState {
  return {
    story: {
      id: 'story_status_test',
      title: 'Status Test',
      idea: 'test idea',
      genre: 'default',
      totalChapters: 1,
      status: 'writing',
      provider: 'openai',
      outputDir,
      createdAt: 1,
      updatedAt: 1,
    },
    idea: 'test idea',
    genre: 'default',
    totalChapters: 1,
    world: null,
    characters: [],
    storyArc: null,
    outline: [],
    actProgress: {},
    chapters: [null],
    currentChapterIndex: 0,
    foreshadowStack: [],
    timeline: undefined,
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: false,
    writeOneChapterOnly: false,
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
    structuredValidationResult: undefined,
  }
}

describe('updateStoryStatusInCheckpoint', () => {
  let outputDir: string | undefined

  afterEach(() => {
    if (outputDir) rmSync(outputDir, { recursive: true, force: true })
    outputDir = undefined
  })

  it('does not expose a freeze story status', () => {
    expect(STORY_STATUSES).not.toContain('freeze')
  })

  it('updates story status in the latest checkpoint before exporting meta projection', async () => {
    outputDir = mkdtempSync(join(tmpdir(), 'museflow-status-'))
    const checkpointer = new JsonCheckpointer()
    const checkpoint = emptyCheckpoint()
    checkpoint.id = 'cp-status-1'
    checkpoint.ts = '2024-01-01T00:00:00.000Z'
    checkpoint.channel_values = makeState(outputDir) as unknown as typeof checkpoint.channel_values

    await checkpointer.put(
      { configurable: { thread_id: 'story_status_test', outputDir } },
      checkpoint,
      { source: 'loop', step: 0, parents: {} },
      {}
    )

    await updateStoryStatusInCheckpoint('story_status_test', outputDir, 'done', checkpointer)

    const tuple = await checkpointer.getTuple({
      configurable: { thread_id: 'story_status_test', outputDir },
    })
    const state = tuple?.checkpoint.channel_values as ReducedGraphState
    expect(state.story.status).toBe('done')

    const meta = JSON.parse(readFileSync(join(outputDir, 'meta.json'), 'utf-8'))
    expect(meta.story.status).toBe('done')
  })
})
