import { describe, expect, it, vi } from 'vitest'
import type { ModelProvider } from '../../src/model/provider.ts'

function createMockProvider(chatResponse?: string): ModelProvider {
  return {
    chat: vi.fn().mockResolvedValue(chatResponse ?? ''),
    chatStructured: vi.fn().mockResolvedValue({}),
  }
}

vi.mock('../../src/genres/registry.js', () => ({
  getGenreSkill: vi.fn((genre: string) => {
    if (genre === 'custom') {
      return {
        name: 'custom',
        chapterPlanning: {
          foreshadowMinFulfillDistance: 1,
          foreshadowMaxFulfillDistance: 3,
          foreshadowMaxStackSize: 2,
        },
      }
    }
    return null
  }),
}))

class TestableForeshadowingAgent
  extends (await import('../../src/agents/foreshadowing.ts')).ForeshadowingAgent
{
  public exposeProcessOutput(
    output: { success: boolean; data?: unknown; error?: string },
    chapterIndex: number,
    existingStack: unknown[],
    chapterContent?: string,
    genre?: string
  ) {
    return this.processOutput(
      output as never,
      chapterIndex,
      existingStack as never,
      chapterContent,
      genre
    )
  }
}

describe('ForeshadowingAgent processOutput', () => {
  it('uses genre-specific planning config when genre is provided', () => {
    const agent = new TestableForeshadowingAgent(createMockProvider())
    const output = {
      success: true,
      data: {
        new_foreshadows: [
          { text: '伏笔一', foreshadow_type: 'planted' },
          { text: '伏笔二', foreshadow_type: 'planted' },
          { text: '伏笔三', foreshadow_type: 'planted' },
        ],
        fulfilled_foreshadows: [],
      },
    }

    const stack = agent.exposeProcessOutput(output, 0, [], '', 'custom')
    expect(stack).toHaveLength(2)
    expect(stack[0]?.expectedFulfillChapter).toBeGreaterThanOrEqual(2)
    expect(stack[0]?.expectedFulfillChapter).toBeLessThanOrEqual(4)
  })

  it('falls back to default config when genre is omitted', () => {
    const agent = new TestableForeshadowingAgent(createMockProvider())
    const output = {
      success: true,
      data: {
        new_foreshadows: [{ text: '伏笔一', foreshadow_type: 'planted' }],
        fulfilled_foreshadows: [],
      },
    }

    const stack = agent.exposeProcessOutput(output, 0, [], '')
    expect(stack).toHaveLength(1)
    expect(stack[0]?.expectedFulfillChapter).toBeGreaterThanOrEqual(3)
  })

  it('returns existing stack on failed output', () => {
    const agent = new TestableForeshadowingAgent(createMockProvider())
    const existing = [{ id: 'existing', text: 'existing' }]
    const stack = agent.exposeProcessOutput(
      { success: false, error: 'parse failed' },
      0,
      existing as never,
      ''
    )
    expect(stack).toBe(existing)
  })
})
