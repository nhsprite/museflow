import { describe, expect, it, vi } from 'vitest'
import { HighLevelOutlineAgent } from '../../src/agents/high-level-outline.js'

const mockChat = vi.fn(async (): Promise<string> => '')

vi.mock('../../src/model/registry.ts', () => ({
  createProvider: () => ({
    chat: mockChat,
  }),
}))

describe('HighLevelOutlineAgent', () => {
  it('parses high-level outline with short descriptions', async () => {
    const agent = new HighLevelOutlineAgent()
    mockChat.mockResolvedValueOnce(JSON.stringify({
      chapters: [
        { number: 1, title: '启程', description: '主角离开家乡，踏上旅途。' },
        { number: 2, title: '遇敌', description: '主角遭遇首个强敌，陷入危机。' },
      ],
    }))

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 2,
    })

    expect(output.success).toBe(true)
    const chapters = (output.data as { chapters: Array<{ number: number; title: string; description: string }> }).chapters
    expect(chapters).toHaveLength(2)
    expect(chapters[0]!.description.length).toBeLessThanOrEqual(60)
  })

  it('returns empty chapters when parse fails', async () => {
    const agent = new HighLevelOutlineAgent()
    mockChat.mockResolvedValueOnce('invalid json')

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 2,
    })

    const data = output.data as { chapters?: unknown[] } | undefined
    expect(data?.chapters ?? []).toHaveLength(0)
  })

  it('reports failure with original content when JSON contains unescaped inner quotes', async () => {
    const agent = new HighLevelOutlineAgent()
    const malformedJson = '```json\n{\n  "chapters": [\n    { "number": 1, "title": "启程", "description": "主角以"义仆"之名潜入王府，谋求复仇。" }\n  ]\n}\n```'
    mockChat.mockResolvedValueOnce(malformedJson)

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 1,
    })

    expect(output.success).toBe(false)
    expect(output.content).toContain('"义仆"')
    expect(output.error).toMatch(/JSON/)
  })

  it('parses outline when descriptions use Chinese quotation marks', async () => {
    const agent = new HighLevelOutlineAgent()
    mockChat.mockResolvedValueOnce('```json\n' + JSON.stringify({
      chapters: [
        { number: 1, title: '启程', description: '主角以「义仆」之名潜入王府，谋求复仇。' },
      ],
    }) + '\n```')

    const output = await agent.run({
      idea: 'a hero journey',
      genre: 'default',
      totalChapters: 1,
    })

    expect(output.success).toBe(true)
    const chapters = (output.data as { chapters: Array<{ title: string; description: string }> }).chapters
    expect(chapters).toHaveLength(1)
    expect(chapters[0]!.description).toContain('「义仆」')
  })
})
