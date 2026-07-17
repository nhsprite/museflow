import { describe, it, expect, vi } from 'vitest'
import { FixAgent } from '../../src/agents/fix.js'
import type { FixAgentInput } from '../../src/agents/types.ts'
import type { ModelProvider } from '../../src/model/provider.ts'
import type { ChapterPlan } from '../../src/agents/types.ts'

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

describe('FixAgent processOutput scope protection', () => {
  const paragraphs = ['段落零。', '原句一。原句二。', '段落二。', '段落三。']

  it('filters sentence fixes to affected paragraphs and warns about out-of-scope edits', () => {
    const agent = createAgent(() => '')
    const output = {
      success: true,
      content: '',
      data: {
        modifiedSentences: [
          { paragraphIndex: 1, sentenceIndex: 0, content: '修改后的句子。' },
          { paragraphIndex: 3, sentenceIndex: 0, content: '范围外修改。' },
          { paragraphIndex: 9, sentenceIndex: 0, content: '越界修改。' },
        ],
      },
    }

    const { content, issues } = agent.processOutput(output, '', paragraphs, [1], 'story', 4)

    expect(content).toContain('修改后的句子。原句二。')
    expect(content).toContain('段落三。')
    expect(content).not.toContain('范围外修改。')
    expect(content).not.toContain('越界修改。')
    expect(issues).toHaveLength(2)
    expect(issues.some((i) => i.description.includes('未受影响段落 3'))).toBe(true)
    expect(issues.some((i) => i.description.includes('超出范围的段落索引 9'))).toBe(true)
  })

  it('warns about affected paragraphs the model did not cover', () => {
    const agent = createAgent(() => '')
    const output = {
      success: true,
      content: '',
      data: {
        modifiedSentences: [{ paragraphIndex: 1, sentenceIndex: 0, content: '修改后的句子。' }],
      },
    }

    const { issues } = agent.processOutput(output, '', paragraphs, [1, 2], 'story', 4)

    const uncovered = issues.find((i) => i.locationRef?.paragraphIndex === 2)
    expect(uncovered).toBeDefined()
    expect(uncovered?.ruleId).toBe('fix.uncovered-paragraph')
    expect(uncovered?.severity).toBe('warning')
    expect(uncovered?.retryStrategy).toBe('fix')
  })

  it('rejects empty paragraph replacements and keeps the original paragraph', () => {
    const agent = createAgent(() => '')
    const output = {
      success: true,
      content: '',
      data: { modifiedParagraphs: [{ index: 1, content: '' }] },
    }

    const { content, issues } = agent.processOutput(output, '', paragraphs, [1], 'story', 4)

    expect(content).toBe(paragraphs.join('\n\n'))
    const emptyWarning = issues.find((i) => i.description.includes('空内容'))
    expect(emptyWarning).toBeDefined()
    expect(emptyWarning?.locationRef?.paragraphIndex).toBe(1)
  })
})

describe('FixAgent chapter contract prompt', () => {
  it('includes expected events and beats in the sentence fix prompt', async () => {
    let capturedMessages: unknown[] = []
    const agent = createAgent((messages) => {
      capturedMessages = messages
      return '=== FIXED_CHAPTER ===\n【段落 1 · 第 1 句】\n修改后的第一句。\n=== END_FIXED_CHAPTER ==='
    })

    const chapterPlan: ChapterPlan = {
      chapterIndex: 3,
      sections: [],
      timeline: [],
      outlineCheck: [],
      expectedEvents: [
        {
          id: 'evt-1',
          chapterIndex: 3,
          source: 'outline',
          type: 'character-location',
          characterId: 'char-1',
          locationId: 'loc-1',
        },
      ],
      claimedBeatIds: ['beat-1'],
      fulfilledForeshadowIds: ['fs-1'],
      introducedForeshadowIds: [],
      resolvedTaskIds: [],
      createdTaskIds: [],
    }

    await agent.run({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterIndex: 3,
      chapterContent: '# 第四章 王府递帖\n\n旧正文。',
      issues: [{ id: '1', type: 'consistency', severity: 'error', description: '矛盾' }],
      previousChapters: '',
      timelineSnapshot: '',
      storyState: '',
      chapterPlan,
      sentenceFix: {
        sentences: [
          {
            paragraphIndex: 1,
            sentenceIndex: 0,
            original: '原句。',
            issue: { id: '1', type: 'consistency', severity: 'error', description: '矛盾' },
          },
        ],
        context: '',
      },
    } as FixAgentInput)

    expect(capturedMessages).toHaveLength(2)
    const userContent = (capturedMessages[1] as { content?: string }).content ?? ''
    expect(userContent).toContain('<chapter_contract>')
    expect(userContent).toContain('<expected_events>')
    expect(userContent).toContain('character-location: char-1 -> loc-1')
    expect(userContent).toContain('<claimed_beats>')
    expect(userContent).toContain('beat-1')
    expect(userContent).toContain('<fulfilled_foreshadows>')
    expect(userContent).toContain('fs-1')
    expect(userContent).toContain('不得破坏本章契约')
  })

  it('omits the contract section when no chapter plan is provided', async () => {
    let capturedMessages: unknown[] = []
    const agent = createAgent((messages) => {
      capturedMessages = messages
      return '=== FIXED_CHAPTER ===\n【段落 1 · 第 1 句】\n修改后的第一句。\n=== END_FIXED_CHAPTER ==='
    })

    await agent.run({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterIndex: 3,
      chapterContent: '# 第四章 王府递帖\n\n旧正文。',
      issues: [{ id: '1', type: 'consistency', severity: 'error', description: '矛盾' }],
      previousChapters: '',
      timelineSnapshot: '',
      storyState: '',
      sentenceFix: {
        sentences: [
          {
            paragraphIndex: 1,
            sentenceIndex: 0,
            original: '原句。',
            issue: { id: '1', type: 'consistency', severity: 'error', description: '矛盾' },
          },
        ],
        context: '',
      },
    } as FixAgentInput)

    const userContent = (capturedMessages[1] as { content?: string }).content ?? ''
    expect(userContent).not.toContain('<chapter_contract>')
  })
})
