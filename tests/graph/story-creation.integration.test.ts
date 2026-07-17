import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, mkdtempSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runStory } from '../../src/core/runner.js'
import { exportMetaFromCheckpoint } from '../../src/storage/meta/exporter.js'
import type { AgentOutput } from '../../src/agents/base.js'
import type { StoryArcAgentInput } from '../../src/agents/types.js'
import type { Character } from '../../src/types/character.js'
import type { WorldContent } from '../../src/types/world.js'
import type { ModelProvider } from '../../src/model/provider.js'
import type { RuntimeContext } from '../../src/core/context.js'
import { JsonCheckpointer } from '../../src/graph/checkpointer.js'

let tmpDir: string

const mockChat = vi.fn(async (): Promise<string> => '')
const mockChatStructured = vi.fn().mockResolvedValue({})

function createMockProvider(): ModelProvider {
  return { chat: mockChat, chatStructured: mockChatStructured }
}

function createMockContext(): RuntimeContext {
  return {
    provider: createMockProvider(),
    checkpointer: new JsonCheckpointer(),
    config: { model: { provider: 'openai', model: 'gpt-4o', temperature: 0.7, maxTokens: 8192 } },
  }
}

function makeWorldOutput(): AgentOutput {
  return { success: true, data: { title: '测试故事', world: '这是一个测试世界观。' } }
}

function makeCharacterOutput(): AgentOutput {
  return {
    success: true,
    data: [
      {
        name: '主角',
        description: '测试主角背景',
        dialogueStyle: '沉稳',
        aliases: [],
        isProtagonist: true,
      },
      {
        name: '配角',
        description: '测试配角背景',
        dialogueStyle: '活泼',
        aliases: [],
        isProtagonist: false,
      },
    ],
  }
}

function makeStoryArcOutput(totalChapters: number): AgentOutput {
  return {
    success: true,
    data: {
      totalChapters,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: totalChapters,
          title: '第一幕',
          theme: '测试主题',
          function: '测试功能',
          mandatoryBeats: ['主角登场'],
        },
      ],
      keyBeats: [],
    },
  }
}

vi.mock('../../src/graph/agent-factory.js', () => ({
  getWorldbuilderAgent: () => ({
    run: vi.fn(async () => makeWorldOutput()),
    processOutput: vi.fn((output: AgentOutput, storyId: string): WorldContent => {
      const data = output.data as { world?: string }
      return {
        id: 'world-test',
        storyId,
        content: data.world ?? '',
      }
    }),
    extractTitle: vi.fn((output: AgentOutput) => {
      const data = output.data as { title?: string }
      return data.title ?? ''
    }),
  }),
  getCharacterAgent: () => ({
    run: vi.fn(async () => makeCharacterOutput()),
    processOutput: vi.fn((output: AgentOutput, storyId: string): Character[] => {
      const data = output.data as Array<{
        name: string
        description: string
        dialogueStyle: string
        aliases: string[]
        isProtagonist: boolean
      }>
      return data.map((c, idx) => ({
        id: `char-test-${idx}`,
        storyId,
        name: c.name,
        aliases: c.aliases,
        isProtagonist: c.isProtagonist,
        description: c.description,
        dialogueStyle: c.dialogueStyle,
        createdAt: Date.now(),
      }))
    }),
  }),
  getStoryArcAgent: () => ({
    run: vi.fn(async (state: StoryArcAgentInput) => makeStoryArcOutput(state.totalChapters ?? 3)),
  }),
  getChapterAgent: vi.fn(),
  getChapterPlannerAgent: vi.fn(),
  getForeshadowingAgent: vi.fn(),
  getConsistencyAgent: vi.fn(),
  getFixAgent: vi.fn(),
  getSummaryAgent: vi.fn(),
}))

describe('story creation integration', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'museflow-story-creation-'))
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it(
    'runs worldbuilding, characters, and outline generation end-to-end',
    { timeout: 30000 },
    async () => {
      const totalChapters = 3

      const story = {
        id: 'story_test_creation',
        title: '测试故事',
        outputDir: tmpDir,
        genre: 'default',
        totalChapters,
        idea: '一个测试故事',
        provider: 'openai' as const,
        status: 'init' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      const result = await runStory(
        {
          storyId: story.id,
          idea: story.idea,
          genre: story.genre,
          totalChapters,
          story,
        },
        createMockContext()
      )

      expect(result.world).not.toBeNull()
      expect(result.world?.content).toBe('这是一个测试世界观。')
      expect(result.characters.length).toBeGreaterThanOrEqual(1)
      expect(result.characters[0].name).toBe('主角')
      expect(result.outline).toHaveLength(totalChapters)
      expect(result.outline[0].title).toBe('')
      expect(result.outline[0].description).toBe('')
      expect(result.storyArc).toBeDefined()
      expect(result.storyArc?.acts).toHaveLength(1)
      expect(result.storyArc?.totalChapters).toBe(totalChapters)

      const checkpointsDir = join(tmpDir, 'checkpoints')
      expect(existsSync(checkpointsDir)).toBe(true)
      expect(existsSync(join(checkpointsDir, 'latest.json'))).toBe(true)
      expect(
        readdirSync(checkpointsDir).some((f) => f.endsWith('.json') && f !== 'pending_writes.json')
      ).toBe(true)

      await exportMetaFromCheckpoint(tmpDir)

      const metaPath = join(tmpDir, 'meta.json')
      expect(existsSync(metaPath)).toBe(true)
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      expect(meta.story.id).toBe(story.id)
      expect(meta.world).not.toBeNull()
      expect(meta.characters.length).toBeGreaterThanOrEqual(1)
      expect(meta.outline).toHaveLength(totalChapters)
    }
  )

  it('uses AI-generated title when story title is empty', { timeout: 30000 }, async () => {
    const totalChapters = 2

    const story = {
      id: 'story_test_creation_empty_title',
      title: '',
      outputDir: tmpDir,
      genre: 'default',
      totalChapters,
      idea: '一个测试故事',
      provider: 'openai' as const,
      status: 'init' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const result = await runStory(
      {
        storyId: story.id,
        idea: story.idea,
        genre: story.genre,
        totalChapters,
        story,
      },
      createMockContext()
    )

    expect(result.story.title).toBe('测试故事')
  })
})
