import { describe, it, expect, vi } from 'vitest'
import { FixAgent } from '../../src/agents/fix.js'
import type { FixAgentInput } from '../../src/agents/types.ts'
import type { ModelProvider } from '../../src/model/provider.ts'

function createMockProvider(
  chat: (messages: unknown[]) => string | Promise<string>
): ModelProvider {
  return {
    chat: async (messages: unknown[]) => chat(messages),
    chatStructured: vi.fn().mockResolvedValue({}),
  }
}

const createAgent = (chat: (messages: unknown[]) => string | Promise<string>) => {
  return new FixAgent(createMockProvider(chat))
}

describe('FixAgent parse', () => {
  it('extracts content between FIXED_CHAPTER markers', async () => {
    const agent = createAgent(
      () =>
        'Some preamble\n=== FIXED_CHAPTER ===\n# 第四章 王府递帖\n\n正文。\n=== END_FIXED_CHAPTER ===\nTrailing text'
    )
    const output = await agent.run({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterIndex: 3,
      chapterContent: '# 第四章 王府递帖\n\n旧正文。',
      issues: [{ id: '1', type: 'consistency', severity: 'error', description: '矛盾' }],
      previousChapters: '',
      timelineSnapshot: '',
      storyState: '',
    } as FixAgentInput)
    expect(output.success).toBe(true)
    expect(output.content).toBe('# 第四章 王府递帖\n\n正文。')
  })

  it('falls back to content after FIXED_CHAPTER marker when no end marker', async () => {
    const agent = createAgent(() => '=== FIXED_CHAPTER ===\n# 第四章 王府递帖\n\n正文。')
    const output = await agent.run({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterIndex: 3,
      chapterContent: '# 第四章 王府递帖\n\n旧正文。',
      issues: [{ id: '1', type: 'consistency', severity: 'error', description: '矛盾' }],
      previousChapters: '',
      timelineSnapshot: '',
      storyState: '',
    } as FixAgentInput)
    expect(output.success).toBe(true)
    expect(output.content).toBe('# 第四章 王府递帖\n\n正文。')
  })

  it('still recognizes sentence fix format', async () => {
    const agent = createAgent(
      () =>
        '=== FIXED_CHAPTER ===\n【段落 1 · 第 1 句】\n修改后的第一句。\n=== END_FIXED_CHAPTER ==='
    )
    const output = await agent.run({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterIndex: 3,
      chapterContent: '# 第四章 王府递帖\n\n旧正文。',
      issues: [{ id: '1', type: 'consistency', severity: 'error', description: '矛盾' }],
      previousChapters: '',
      timelineSnapshot: '',
      storyState: '',
    } as FixAgentInput)
    expect(output.success).toBe(true)
    expect(output.data).toEqual({
      modifiedSentences: [{ paragraphIndex: 1, sentenceIndex: 0, content: '修改后的第一句。' }],
    })
  })

  it('strips pre-write checklist artifacts before the chapter heading', async () => {
    const agent = createAgent(
      () =>
        '=== FIXED_CHAPTER ===\n=== PRE_WRITE_CHECK ===\n- [ ] 不引入新角色\n- [ ] 保持时间线一致\n=== CHAPTER_CONTENT ===\n# 第四章 王府递帖\n\n正文。\n=== END_FIXED_CHAPTER ==='
    )
    const output = await agent.run({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterIndex: 3,
      chapterContent: '# 第四章 王府递帖\n\n旧正文。',
      issues: [{ id: '1', type: 'consistency', severity: 'error', description: '矛盾' }],
      previousChapters: '',
      timelineSnapshot: '',
      storyState: '',
    } as FixAgentInput)
    expect(output.success).toBe(true)
    expect(output.content).toBe('# 第四章 王府递帖\n\n正文。')
  })

  it('truncates to chapter heading when PRE_WRITE_CHECK residue lacks CHAPTER_CONTENT marker', async () => {
    const agent = createAgent(
      () =>
        '=== FIXED_CHAPTER ===\n=== PRE_WRITE_CHECK ===\n- 检查角色一致性\n- 检查时间线\n# 第四章 王府递帖\n\n正文。\n=== END_FIXED_CHAPTER ==='
    )
    const output = await agent.run({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterIndex: 3,
      chapterContent: '# 第四章 王府递帖\n\n旧正文。',
      issues: [{ id: '1', type: 'consistency', severity: 'error', description: '矛盾' }],
      previousChapters: '',
      timelineSnapshot: '',
      storyState: '',
    } as FixAgentInput)
    expect(output.success).toBe(true)
    expect(output.content).toBe('# 第四章 王府递帖\n\n正文。')
  })
})
