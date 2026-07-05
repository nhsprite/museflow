import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Command } from 'commander'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Story } from '../../src/types/story.ts'
import type { ReducedGraphState } from '../../src/graph/state.ts'
import type { StoryState } from '../../src/types/story-state.ts'
import type { StoryMemory } from '../../src/types/story-memory.ts'

const testTempDir = join(tmpdir(), `museflow-migrate-memory-${randomUUID().slice(0, 8)}`)

const requireStoryMock = vi.fn<() => Promise<Story>>()
const getStateMock = vi.fn<() => Promise<ReducedGraphState | null>>()
const updateLatestStateMock = vi.fn<() => Promise<void>>()
const exportMetaFromCheckpointMock = vi.fn<() => Promise<void>>()
const migrateFromStoryStateMock =
  vi.fn<(storyState: StoryState, currentChapterIndex: number) => StoryMemory>()

vi.mock('../../src/cli/utils/story-loader.js', () => ({
  requireStory: requireStoryMock,
}))

vi.mock('../../src/core/runner.js', () => ({
  getState: getStateMock,
}))

vi.mock('../../src/storage/checkpoint-service.js', () => ({
  createCheckpointService: () => ({
    updateLatestState: updateLatestStateMock,
  }),
}))

vi.mock('../../src/storage/meta/exporter.js', () => ({
  exportMetaFromCheckpoint: exportMetaFromCheckpointMock,
}))

vi.mock('../../src/story-memory/migrator.js', () => ({
  migrateFromStoryState: migrateFromStoryStateMock,
}))

let registerMigrateMemoryCommand: (program: Command) => void

function makeStory(): Story {
  return {
    id: 'story-1',
    title: 'Test Story',
    idea: 'test',
    genre: 'default',
    totalChapters: 10,
    status: 'writing',
    provider: 'openai',
    outputDir: testTempDir,
    createdAt: 0,
    updatedAt: 0,
  }
}

function makeStoryState(): StoryState {
  return {
    characterLocations: { alice: 'beijing' },
    characterStatus: { alice: 'alive' },
    keyItemsLocation: { sword: 'temple' },
    keyItemsState: { sword: 'broken' },
    activePlots: [],
    revealedSecrets: [],
    pendingTasks: [
      {
        id: 't1',
        assignee: 'alice',
        description: 'find the sword',
        createdChapter: 1,
        status: 'pending',
      },
    ],
    currentScene: 'temple',
    storyTime: 'morning',
  }
}

function makeState(overrides: Partial<ReducedGraphState> = {}): ReducedGraphState {
  return {
    story: makeStory(),
    idea: 'test',
    genre: 'default',
    totalChapters: 10,
    currentChapterIndex: 2,
    chapters: [],
    outline: [],
    storyArc: null,
    actProgress: {},
    foreshadowStack: [],
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
    isWriting: false,
    writeOneChapterOnly: true,
    lastPrintedChapter: -1,
    lastTimelineSnapshot: null,
    chapterPlan: null,
    storyState: makeStoryState(),
    chapterTimeAnchor: undefined,
    autoFixAttempts: 0,
    verifiedConstraints: [],
    chapterReport: null,
    blockingReport: null,
    session: {
      chapterIndex: 2,
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
    ...overrides,
  } as unknown as ReducedGraphState
}

function makeDummyStoryMemory(): StoryMemory {
  return {
    version: '1',
    lastChapterIndex: 2,
    entities: {
      characters: {},
      items: {},
      locations: {},
      factions: {},
      plots: {},
    },
    events: [],
    foreshadows: {},
    beats: {},
    tasks: {},
  }
}

describe('migrate-memory command', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    requireStoryMock.mockResolvedValue(makeStory())
    getStateMock.mockResolvedValue(makeState())
    migrateFromStoryStateMock.mockReturnValue(makeDummyStoryMemory())

    const mod = await import('../../src/cli/commands/migrate-memory.js')
    registerMigrateMemoryCommand = mod.registerMigrateMemoryCommand
  })

  it('registers the migrate-memory command', () => {
    const program = new Command()
    registerMigrateMemoryCommand(program)

    const command = program.commands.find((c) => c.name() === 'migrate-memory')
    expect(command).toBeDefined()
    expect(command?.description()).toContain('StoryMemory')
  })

  it('migrates a story that does not have storyMemory', async () => {
    const program = new Command()
    registerMigrateMemoryCommand(program)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'migrate-memory', 'story-1'])

    expect(migrateFromStoryStateMock).toHaveBeenCalledTimes(1)
    expect(migrateFromStoryStateMock).toHaveBeenCalledWith(makeStoryState(), 2)
    expect(updateLatestStateMock).toHaveBeenCalledTimes(1)
    expect(updateLatestStateMock).toHaveBeenCalledWith({ storyMemory: makeDummyStoryMemory() })
    expect(exportMetaFromCheckpointMock).toHaveBeenCalledTimes(1)
    expect(exportMetaFromCheckpointMock).toHaveBeenCalledWith(testTempDir)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('已将 story-1 迁移到 StoryMemory'))

    logSpy.mockRestore()
  })

  it('skips migration when storyMemory already exists', async () => {
    getStateMock.mockResolvedValue(makeState({ storyMemory: makeDummyStoryMemory() }))

    const program = new Command()
    registerMigrateMemoryCommand(program)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync(['node', 'test', 'migrate-memory', 'story-1'])

    expect(migrateFromStoryStateMock).not.toHaveBeenCalled()
    expect(updateLatestStateMock).not.toHaveBeenCalled()
    expect(exportMetaFromCheckpointMock).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('已经存在 StoryMemory'))

    logSpy.mockRestore()
  })

  it('reports an error when the story state cannot be loaded', async () => {
    getStateMock.mockResolvedValue(null)

    const program = new Command()
    registerMigrateMemoryCommand(program)

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: number | string | null) => {
        throw new Error(`process.exit:${code}`)
      })

    await expect(program.parseAsync(['node', 'test', 'migrate-memory', 'story-1'])).rejects.toThrow(
      'process.exit:1'
    )

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('无法获取故事'))
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(updateLatestStateMock).not.toHaveBeenCalled()

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })
})
