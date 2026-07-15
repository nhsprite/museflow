import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ReducedGraphState } from '../../src/graph/state.ts'
import type { Story } from '../../src/types/story.ts'
import { createEmptyStoryMemory } from '../../src/story-memory/projector.ts'
import { projectForeshadowStack } from '../../src/story-memory/foreshadow-policy.ts'

const getStoryMock = vi.fn<() => Story | null>()
const getStateMock = vi.fn<() => Promise<ReducedGraphState | null>>()
const getGenreSkillMock = vi.fn()
const loadConfigMock = vi.fn()
const tempDir = join(tmpdir(), `museflow-info-${randomUUID().slice(0, 8)}`)

vi.mock('../../src/storage/meta/stores/story.ts', () => ({
  getStory: getStoryMock,
  initStoryDb: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/core/runner.ts', () => ({
  getState: getStateMock,
}))

vi.mock('../../src/genres/registry.ts', () => ({
  getGenreSkill: getGenreSkillMock,
}))

vi.mock('../../src/config/store.ts', () => ({
  loadConfig: loadConfigMock,
}))

function createStory(): Story {
  return {
    id: 'story-1',
    idea: '一个少年踏上修仙路',
    title: '',
    genre: 'xianxia',
    totalChapters: 3,
    status: 'writing',
    provider: 'openai',
    outputDir: tempDir,
    createdAt: 0,
    updatedAt: 0,
  }
}

function createState(currentChapterIndex: number, totalChapters: number): ReducedGraphState {
  return {
    story: createStory(),
    idea: '一个少年踏上修仙路',
    genre: 'xianxia',
    totalChapters,
    world: null,
    characters: [],
    outline: [],
    chapters: new Array(totalChapters).fill(null),
    currentChapterIndex,
    foreshadowStack: [],
    chapterSummaries: [],
    pendingIssues: [],
    rewriteApproved: false,
    rewriteRequested: false,
  }
}

describe('info command chapter display', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getStoryMock.mockReturnValue(createStory())
    getGenreSkillMock.mockReturnValue(null)
    loadConfigMock.mockReturnValue({
      model: { provider: 'openai', model: 'gpt-4o' },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the first chapter as 1-based', async () => {
    getStateMock.mockResolvedValue(createState(0, 3))
    const { info } = await import('../../src/cli/commands/info.ts')

    await info({ storyId: 'story-1' })

    expect(logSpy).toHaveBeenCalledWith('  当前章节: 1/3')
  })

  it('clamps the display chapter when the story is complete', async () => {
    getStateMock.mockResolvedValue(createState(3, 3))
    const { info } = await import('../../src/cli/commands/info.ts')

    await info({ storyId: 'story-1' })

    expect(logSpy).toHaveBeenCalledWith('  当前章节: 3/3')
  })

  it('reports active foreshadows by policy without treating soft clues as deadlines', async () => {
    const state = createState(1, 3)
    state.storyMemory = {
      ...createEmptyStoryMemory(),
      foreshadows: {
        hard: {
          id: 'fs-hard',
          text: 'hard fixture',
          kind: null,
          introducedIn: 0,
          expectedFulfillChapter: 3,
          fulfilledIn: null,
          resolutionPolicy: 'must_resolve',
          required: true,
          beatId: null,
        },
        soft: {
          id: 'fs-soft',
          text: 'soft fixture',
          kind: null,
          introducedIn: 0,
          expectedFulfillChapter: null,
          fulfilledIn: null,
          resolutionPolicy: 'should_resolve',
          required: true,
          beatId: null,
        },
        open: {
          id: 'fs-open',
          text: 'open fixture',
          kind: null,
          introducedIn: 0,
          expectedFulfillChapter: null,
          fulfilledIn: null,
          resolutionPolicy: 'may_remain_open',
          required: false,
          beatId: null,
        },
      },
    }
    state.foreshadowStack = projectForeshadowStack(state.storyMemory)
    getStateMock.mockResolvedValue(state)
    const { info } = await import('../../src/cli/commands/info.ts')

    await info({ storyId: 'story-1' })

    const output = logSpy.mock.calls.map(([value]) => String(value)).join('\n')
    expect(output).toContain('必须回收: 1')
    expect(output).toContain('建议自然回收: 1')
    expect(output).toContain('可保持开放: 1')
    expect(output).toContain('第3章回收')
    expect(output).not.toContain(`第${Number.MAX_SAFE_INTEGER}章回收`)
  })
})
