import { describe, expect, it, vi } from 'vitest'
import type { ModelProvider } from '../../src/model/provider.ts'
import type { ForeshadowingAgentInput } from '../../src/agents/types.ts'

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
  public exposePrompt(state: ForeshadowingAgentInput) {
    return this.buildPrompt(state)
  }

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

describe('ForeshadowingAgent prompt', () => {
  it('keeps optional overdue foreshadows out of mandatory deadline sections', () => {
    const agent = new TestableForeshadowingAgent(createMockProvider())
    const messages = agent.exposePrompt({
      idea: '测试',
      genre: 'default',
      totalChapters: 20,
      chapterIndex: 9,
      chapterContent: '正文。',
      chapterSummaries: [],
      foreshadowStack: [
        {
          id: 'fs-required',
          text: '必需旧伏笔',
          expectedFulfillChapter: 5,
          createdAt: 0,
          createdAtChapter: 1,
          status: 'planted',
          isExplicit: true,
          required: true,
        },
        {
          id: 'fs-optional',
          text: '可选环境细节',
          expectedFulfillChapter: 5,
          createdAt: 0,
          createdAtChapter: 1,
          status: 'planted',
          isExplicit: false,
          required: false,
        },
      ],
    })

    const userMessage = messages[1]?.content ?? ''
    const overdueSection = userMessage.match(/<overdue>([\s\S]*?)<\/overdue>/)?.[1] ?? ''
    expect(overdueSection).toContain('必需旧伏笔')
    expect(overdueSection).not.toContain('可选环境细节')
  })
})

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

  it('does not automatically fulfill overdue foreshadows without model evidence', () => {
    const agent = new TestableForeshadowingAgent(createMockProvider())
    const existing = [
      {
        id: 'fs-overdue',
        text: '一条必须由正文显式回收的旧伏笔',
        expectedFulfillChapter: 2,
        createdAtChapter: 1,
        createdAt: 1,
        status: 'planted',
        isExplicit: false,
        required: true,
      },
    ]

    const stack = agent.exposeProcessOutput(
      {
        success: true,
        data: {
          new_foreshadows: [],
          fulfilled_foreshadows: [],
          overdue_foreshadows: ['fs-overdue'],
        },
      },
      4,
      existing,
      '',
      'default'
    )

    expect(stack[0]?.fulfilledChapter).toBeUndefined()
  })
})
