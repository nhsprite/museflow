import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ReducedGraphState } from '../../src/graph/state.ts'
import type { Story } from '../../src/types/story.ts'
import { applyEvents, createEmptyStoryMemory } from '../../src/story-memory/projector.ts'
import { projectForeshadowStack } from '../../src/story-memory/foreshadow-policy.ts'
import type { StoryMemory } from '../../src/types/story-memory.ts'

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

function createAliasedForeshadowMemory(): StoryMemory {
  return applyEvents(createEmptyStoryMemory(), [
    {
      id: 'intro-active-early',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-active-early',
      text: 'active canonical fixture',
      expectedFulfillChapter: null,
      resolutionPolicy: 'should_resolve',
      chapterIndex: 0,
      source: 'outline',
    },
    {
      id: 'intro-active-late',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-active-late',
      text: 'active alias fixture',
      expectedFulfillChapter: null,
      resolutionPolicy: 'should_resolve',
      chapterIndex: 1,
      source: 'outline',
    },
    {
      id: 'merge-active',
      type: 'foreshadow-merge',
      canonicalForeshadowId: 'fs-active-early',
      duplicateForeshadowId: 'fs-active-late',
      reason: 'same active neutral fixture',
      chapterIndex: 1,
      source: 'outline',
    },
    {
      id: 'intro-fulfilled-early',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-fulfilled-early',
      text: 'fulfilled canonical fixture',
      expectedFulfillChapter: 3,
      resolutionPolicy: 'must_resolve',
      chapterIndex: 0,
      source: 'outline',
    },
    {
      id: 'intro-fulfilled-late',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-fulfilled-late',
      text: 'fulfilled alias fixture',
      expectedFulfillChapter: 3,
      resolutionPolicy: 'must_resolve',
      chapterIndex: 1,
      source: 'outline',
    },
    {
      id: 'fulfill-late',
      type: 'foreshadow-fulfill',
      foreshadowId: 'fs-fulfilled-late',
      chapterIndex: 2,
      source: 'chapter',
    },
    {
      id: 'merge-fulfilled',
      type: 'foreshadow-merge',
      canonicalForeshadowId: 'fs-fulfilled-early',
      duplicateForeshadowId: 'fs-fulfilled-late',
      reason: 'same fulfilled neutral fixture',
      chapterIndex: 2,
      source: 'outline',
    },
  ])
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
        'fs-hard': {
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
        'fs-soft': {
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
        'fs-open': {
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

  it('reports active and fulfilled canonical obligations once without listing alias ids', async () => {
    const state = createState(2, 3)
    state.storyMemory = createAliasedForeshadowMemory()
    state.foreshadowStack = projectForeshadowStack(state.storyMemory)
    getStateMock.mockResolvedValue(state)
    const { info } = await import('../../src/cli/commands/info.ts')

    await info({ storyId: 'story-1' })

    const output = logSpy.mock.calls.map(([value]) => String(value)).join('\n')
    expect(output).toContain('伏笔: 1 个未结, 1 个已回收')
    expect(output).toContain('[fs-active-early]')
    expect(output).toContain('fulfilled canonical fixture')
    expect(output).not.toContain('fs-active-late')
    expect(output).not.toContain('fulfilled alias fixture')
  })
})
