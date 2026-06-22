import { describe, it, expect, vi } from 'vitest'
import { FixAgent } from '../../src/agents/fix.js'

const createAgent = (chat: (messages: unknown[]) => string | Promise<string>) => {
  const agent = new FixAgent()
  Object.defineProperty(agent, 'provider', {
    value: { chat: async (messages: unknown[]) => chat(messages) },
    writable: true,
  })
  return agent
}

describe('FixAgent parse', () => {
  it('extracts content between FIXED_CHAPTER markers', async () => {
    const agent = createAgent(() =>
      'Some preamble\n=== FIXED_CHAPTER ===\n# 第四章 王府递帖\n\n正文。\n=== END_FIXED_CHAPTER ===\nTrailing text'
    )
    const output = await agent.run({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterIndex: 3,
      chapterContent: '# 第四章 王府递帖\n\n旧正文。',
      issues: [{ id: '1', type: 'consistency', severity: 'error', description: '矛盾' }],
    })
    expect(output.success).toBe(true)
    expect(output.content).toBe('# 第四章 王府递帖\n\n正文。')
  })

  it('falls back to content after FIXED_CHAPTER marker when no end marker', async () => {
    const agent = createAgent(() =>
      '=== FIXED_CHAPTER ===\n# 第四章 王府递帖\n\n正文。'
    )
    const output = await agent.run({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterIndex: 3,
      chapterContent: '# 第四章 王府递帖\n\n旧正文。',
      issues: [{ id: '1', type: 'consistency', severity: 'error', description: '矛盾' }],
    })
    expect(output.success).toBe(true)
    expect(output.content).toBe('# 第四章 王府递帖\n\n正文。')
  })

  it('still recognizes sentence fix format', async () => {
    const agent = createAgent(() =>
      '=== FIXED_CHAPTER ===\n【段落 1 · 第 1 句】\n修改后的第一句。\n=== END_FIXED_CHAPTER ==='
    )
    const output = await agent.run({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterIndex: 3,
      chapterContent: '# 第四章 王府递帖\n\n旧正文。',
      issues: [{ id: '1', type: 'consistency', severity: 'error', description: '矛盾' }],
    })
    expect(output.success).toBe(true)
    expect(output.data).toEqual({
      modifiedSentences: [{ paragraphIndex: 1, sentenceIndex: 0, content: '修改后的第一句。' }],
    })
  })
})
