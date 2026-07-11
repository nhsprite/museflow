import { describe, expect, it, vi } from 'vitest'
import type { Message, ModelProvider } from '../../src/model/provider.ts'
import type { SummaryAgentInput } from '../../src/agents/types.ts'

function createMockProvider(chatResponse?: string): ModelProvider {
  return {
    chat: vi.fn().mockResolvedValue(chatResponse ?? ''),
    chatStructured: vi.fn().mockResolvedValue({}),
  }
}

class TestableSummaryAgent extends (await import('../../src/agents/summary.ts')).SummaryAgent {
  public exposePrompt(state: Required<SummaryAgentInput>): Message[] {
    return this.buildPrompt(state)
  }
}

describe('SummaryAgent prompt', () => {
  it('includes chapter content in the prompt', () => {
    const agent = new TestableSummaryAgent(createMockProvider())
    const chapterContent = '顾承舟站在办公室窗前，看着窗外的城市夜景。电话响了，是苏晚棠打来的。'

    const messages = agent.exposePrompt({
      idea: '一个关于复仇与救赎的故事',
      genre: 'urban',
      totalChapters: 40,
      chapterContent,
      chapterTitle: '夜幕降临',
      chapterIndex: 32,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    const userMessage = messages.find((m) => m.role === 'user')?.content ?? ''
    expect(userMessage).toContain(chapterContent)
    expect(userMessage).toContain('<chapter_content>')
  })

  it('includes chapter title and index in the prompt', () => {
    const agent = new TestableSummaryAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterContent: 'test content',
      chapterTitle: 'Test Title',
      chapterIndex: 5,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    const userMessage = messages.find((m) => m.role === 'user')?.content ?? ''
    expect(userMessage).toContain('<title>Test Title</title>')
    expect(userMessage).toContain('<number>第6章</number>')
  })

  it('shows empty content placeholder when chapterContent is undefined', () => {
    const agent = new TestableSummaryAgent(createMockProvider())

    const messages = agent.exposePrompt({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterContent: undefined as unknown as string,
      chapterTitle: undefined,
      chapterIndex: undefined,
      foreshadowStack: [],
      chapterSummaries: [],
    })

    const userMessage = messages.find((m) => m.role === 'user')?.content ?? ''
    expect(userMessage).toContain('（无内容）')
    expect(userMessage).toContain('<title>未知</title>')
    expect(userMessage).toContain('<number>未知</number>')
  })

  it('includes official character whitelist in prompt', () => {
    const agent = new TestableSummaryAgent(createMockProvider())
    const messages = agent.exposePrompt({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterContent: '苏半城在房中。',
      chapterTitle: 'Test',
      chapterIndex: 0,
      foreshadowStack: [],
      chapterSummaries: [],
      charactersList: [
        { id: '1', storyId: 's', name: '苏半城', description: '主角', createdAt: 1 },
      ],
    })
    const userMessage = messages.find((m) => m.role === 'user')?.content ?? ''
    expect(userMessage).toContain('<official_characters>')
    expect(userMessage).toContain('苏半城')
  })

  it('includes story event schema in prompt', () => {
    const agent = new TestableSummaryAgent(createMockProvider())
    const messages = agent.exposePrompt({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterContent: 'test content',
      chapterTitle: 'Test',
      chapterIndex: 5,
      foreshadowStack: [],
      chapterSummaries: [],
    })
    const userMessage = messages.find((m) => m.role === 'user')?.content ?? ''
    expect(userMessage).toContain('<chapter_summary>')
    expect(userMessage).toContain('<chapter_handoff>')
    expect(userMessage).toContain('<story_events>')
    expect(userMessage).toContain('character-location')
    expect(userMessage).toContain('plot-advance')
    expect(userMessage).toContain('task-create')
  })

  it('extracts chapterSummary and storyEvents from structured output', async () => {
    const response = `<chapter_summary>
主角抵达京城，与旧友重逢。
</chapter_summary>

<story_events>
[
  { "id": "evt-1", "type": "character-location", "characterId": "c-1", "locationId": "l-1", "chapterIndex": 1, "source": "chapter", "evidence": { "paragraphIndex": 1 } },
  { "id": "evt-2", "type": "plot-advance", "plotId": "p-1", "beatId": "A1-B1", "chapterIndex": 1, "source": "chapter", "evidence": { "paragraphIndex": 1 } }
]
</story_events>`
    const agent = new TestableSummaryAgent(createMockProvider(response))
    const result = await agent.run({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterContent: '主角抵达京城，与旧友重逢。',
      chapterTitle: '重逢',
      chapterIndex: 1,
      charactersList: [],
      foreshadowStack: [],
      chapterSummaries: [],
    })
    expect(result.success).toBe(true)
    expect(result.data?.storyEvents).toBeDefined()
    expect(result.data?.chapterSummary).toBeDefined()
    expect(result.data?.chapterSummary).toContain('重逢')
    expect(result.data?.storyEvents).toHaveLength(2)
  })

  it('extracts chapter handoff from structured output', async () => {
    const response = `<chapter_summary>
主角停在楼梯口，听见门后的低声争执。
</chapter_summary>

<chapter_handoff>
{
  "chapterNumber": 3,
  "endScene": "教学楼楼梯口",
  "endTime": "傍晚",
  "charactersPresent": ["char-1"],
  "lastAction": "主角停在楼梯口，准备推门",
  "openQuestions": ["门后的争执对象尚未确认"],
  "requiredNextOpening": "下一章从主角推门前的停顿承接"
}
</chapter_handoff>

<story_events>
[]
</story_events>`
    const agent = new TestableSummaryAgent(createMockProvider(response))

    const result = await agent.run({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterContent: '主角停在楼梯口，听见门后的低声争执。',
      chapterTitle: '门后',
      chapterIndex: 2,
      charactersList: [],
      foreshadowStack: [],
      chapterSummaries: [],
    })

    expect(result.success).toBe(true)
    expect(result.data?.chapterHandoff).toEqual({
      chapterNumber: 3,
      endScene: '教学楼楼梯口',
      endTime: '傍晚',
      charactersPresent: ['char-1'],
      lastAction: '主角停在楼梯口，准备推门',
      openQuestions: ['门后的争执对象尚未确认'],
      requiredNextOpening: '下一章从主角推门前的停顿承接',
    })
  })

  it('filters invalid story events from structured output', async () => {
    const response = `<chapter_summary>
主角抵达京城。
</chapter_summary>

<story_events>
[
  { "id": "evt-1", "type": "character-location", "characterId": "c-1", "locationId": "l-1", "chapterIndex": 1, "source": "chapter", "evidence": { "paragraphIndex": 1 } },
  { "id": "evt-2", "type": "invalid-type", "chapterIndex": 1, "source": "chapter" }
]
</story_events>`
    const agent = new TestableSummaryAgent(createMockProvider(response))
    const result = await agent.run({
      idea: 'test',
      genre: 'default',
      totalChapters: 10,
      chapterContent: '主角抵达京城。',
      chapterTitle: '抵达',
      chapterIndex: 1,
      charactersList: [],
      foreshadowStack: [],
      chapterSummaries: [],
    })
    expect(result.success).toBe(true)
    expect(result.data?.storyEvents).toHaveLength(1)
    expect(result.data?.storyEvents?.[0].type).toBe('character-location')
  })
})
