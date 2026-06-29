import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runStory } from '../../src/core/runner.js'
import { exportMetaFromCheckpoint } from '../../src/storage/meta/exporter.js'
import type { AgentState, AgentOutput } from '../../src/agents/base.js'
import type { Character } from '../../src/types/character.js'
import type { WorldContent } from '../../src/types/world.js'

let tmpDir: string

vi.mock('../../src/model/registry.js', () => ({
  createProvider: vi.fn(() => {
    throw new Error('createProvider should not be called in integration tests')
  }),
  AnthropicCompatibleProvider: class {},
}))

function makeWorldOutput(): AgentOutput {
  return { success: true, data: { title: '测试故事', world: '这是一个测试世界观。' } }
}

function makeCharacterOutput(): AgentOutput {
  return {
    success: true,
    data: [
      { 姓名: '主角', 背景故事: '测试主角背景', 对话风格: '沉稳' },
      { 姓名: '配角', 背景故事: '测试配角背景', 对话风格: '活泼' },
    ],
  }
}

function makeOutlineOutput(totalChapters: number): AgentOutput {
  return {
    success: true,
    data: {
      chapters: Array.from({ length: totalChapters }, (_, i) => ({
        number: i + 1,
        title: `第${i + 1}章`,
        description: `这是第${i + 1}章的描述。`,
        introducedCharacters: i === 0 ? ['主角'] : [],
      })),
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
      const data = output.data as Array<Record<string, string>>
      return data.map((c, idx) => ({
        id: `char-test-${idx}`,
        storyId,
        name: String(c['姓名'] || c['name'] || '未命名'),
        description: (c['背景故事'] || c['description'] || null) as string | null,
        dialogueStyle: (c['对话风格'] || c['dialogueStyle'] || null) as string | null,
        createdAt: Date.now(),
      }))
    }),
  }),
  getHighLevelOutlineAgent: () => ({
    run: vi.fn(async (state: AgentState) => makeOutlineOutput(state.totalChapters ?? 3)),
  }),
  getChapterAgent: vi.fn(),
  getChapterPlannerAgent: vi.fn(),
  getQualityAgent: vi.fn(),
  getForeshadowingAgent: vi.fn(),
  getHallucinationAgent: vi.fn(),
  getConsistencyAgent: vi.fn(),
  getOutlineComplianceAgent: vi.fn(),
  getFixAgent: vi.fn(),
  getSummaryAgent: vi.fn(),
}))

describe('story creation integration', () => {
  beforeEach(() => {
    tmpDir = join(process.cwd(), 'tests', 'tmp', `story-creation-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('runs worldbuilding, characters, and outline generation end-to-end', { timeout: 30000 }, async () => {
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

    const result = await runStory({
      storyId: story.id,
      idea: story.idea,
      genre: story.genre,
      totalChapters,
      story,
    })

    expect(result.world).not.toBeNull()
    expect(result.world?.content).toBe('这是一个测试世界观。')
    expect(result.characters.length).toBeGreaterThanOrEqual(1)
    expect(result.characters[0].name).toBe('主角')
    expect(result.outline).toHaveLength(totalChapters)
    expect(result.outline[0].title).toBe('第1章')
    expect(result.outline[0].description).toBe('这是第1章的描述。')

    const checkpointsDir = join(tmpDir, 'checkpoints')
    expect(existsSync(checkpointsDir)).toBe(true)
    expect(existsSync(join(checkpointsDir, 'latest.json'))).toBe(true)
    expect(readdirSync(checkpointsDir).some(f => f.endsWith('.json') && f !== 'pending_writes.json')).toBe(true)

    await exportMetaFromCheckpoint(tmpDir)

    const metaPath = join(tmpDir, 'meta.json')
    expect(existsSync(metaPath)).toBe(true)
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    expect(meta.story.id).toBe(story.id)
    expect(meta.world).not.toBeNull()
    expect(meta.characters.length).toBeGreaterThanOrEqual(1)
    expect(meta.outline).toHaveLength(totalChapters)
  })

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

    const result = await runStory({
      storyId: story.id,
      idea: story.idea,
      genre: story.genre,
      totalChapters,
      story,
    })

    expect(result.story.title).toBe('测试故事')
  })
})
