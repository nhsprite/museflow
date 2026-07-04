import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportMetaFromCheckpoint } from '../../../src/storage/meta/exporter.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import { createEmptyStoryState } from '../../../src/storage/meta/stores/story-state.js'
import * as checkpointerModule from '../../../src/graph/checkpointer.js'

function createMockState(): ReducedGraphState {
  return {
    story: {
      id: 'story_abc',
      title: 'Test Story',
      outputDir: '',
      genre: 'default',
      totalChapters: 3,
      status: 'writing',
      provider: 'openai',
      createdAt: 0,
      updatedAt: 0,
    },
    idea: 'test idea',
    genre: 'default',
    totalChapters: 3,
    world: { id: 'world_1', storyId: 'story_abc', content: '世界观内容' },
    characters: [
      {
        id: 'char_1',
        storyId: 'story_abc',
        name: '主角',
        description: '主角描述',
        dialogueStyle: null,
        createdAt: 0,
      },
    ],
    outline: [{ number: 1, title: '第一章', description: '开始' }],
    chapters: [null, null, null],
    currentChapterIndex: 1,
    foreshadowStack: [],
    chapterSummaries: ['第一章摘要'],
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
    verifiedConstraints: [],
    chapterReport: null,
    authorDecisions: {},
    session: {
      chapterIndex: 1,
      rewriteAttempts: 0,
      errorRewriteAttempts: 0,
      autoFixAttempts: 0,
      previousIssues: [],
      previousRawErrorCount: 0,
      routingDecision: undefined,
      forceStructuralRewrite: false,
      rewriteApproved: false,
    },
  } as unknown as ReducedGraphState
}

describe('exportMetaFromCheckpoint', () => {
  let tmpDir: string
  let getTupleMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'museflow-exporter-'))
    getTupleMock = vi.fn()
    vi.spyOn(checkpointerModule, 'getCheckpointer').mockReturnValue({
      getTuple: getTupleMock,
    } as unknown as checkpointerModule.JsonCheckpointer)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('exports checkpoint state to meta.json', async () => {
    const state = createMockState()
    state.story.outputDir = tmpDir

    getTupleMock.mockResolvedValue({
      checkpoint: {
        channel_values: state,
      },
    })

    await exportMetaFromCheckpoint(tmpDir)

    const metaPath = join(tmpDir, 'meta.json')
    expect(existsSync(metaPath)).toBe(true)

    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    expect(meta.story.id).toBe('story_abc')
    expect(meta.story.title).toBe('Test Story')
    expect(meta.world).toMatchObject({ storyId: 'story_abc', content: '世界观内容' })
    expect(meta.characters).toHaveLength(1)
    expect(meta.outline).toHaveLength(1)
    expect(meta.foreshadowStack).toEqual([])
  })

  it('preserves existing timeline when exporting', async () => {
    const state = createMockState()
    state.story.outputDir = tmpDir

    const metaPath = join(tmpDir, 'meta.json')
    const existingTimeline = [{ id: 'ts_1', storyId: 'story_abc', createdAt: 123 }]
    const existingMeta = {
      story: state.story,
      world: null,
      characters: [],
      outline: [],
      chapters: [],
      timeline: existingTimeline,
    }
    const fs = await import('node:fs')
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(metaPath, JSON.stringify(existingMeta), 'utf-8')

    getTupleMock.mockResolvedValue({
      checkpoint: {
        channel_values: state,
      },
    })

    await exportMetaFromCheckpoint(tmpDir)

    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    expect(meta.timeline).toEqual(existingTimeline)
    expect(meta.world).toMatchObject({ content: '世界观内容' })
  })

  it('does nothing when no checkpoint exists', async () => {
    getTupleMock.mockResolvedValue(null)

    await exportMetaFromCheckpoint(tmpDir)

    expect(existsSync(join(tmpDir, 'meta.json'))).toBe(false)
  })
})
