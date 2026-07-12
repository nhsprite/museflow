import { describe, expect, it, vi } from 'vitest'
import { buildChapterAgentContext } from '../../../src/graph/utils/chapter-context.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { CanonicalFact, StoryState } from '../../../src/types/story-state.js'
import type { ModelProvider } from '../../../src/model/provider.js'

function emptyState(): StoryState {
  return {
    characterLocations: {},
    characterStatus: {},
    keyItemsLocation: {},
    keyItemsState: {},
    activePlots: [],
    revealedSecrets: [],
    pendingTasks: [],
    currentScene: '',
    storyTime: '',
  }
}

function makeFact(overrides: Partial<CanonicalFact> & { id: string }): CanonicalFact {
  return {
    subject: 'subject',
    attribute: 'location',
    value: 'value',
    establishedIn: 0,
    confidence: 'high',
    source: 'chapter_text',
    ...overrides,
  }
}

function makeGraphState(canonicalFacts: CanonicalFact[]): ReducedGraphState {
  return {
    story: {
      id: 's',
      title: '测试',
      idea: '',
      genre: 'default',
      totalChapters: 10,
      status: 'writing',
      provider: 'openai',
      outputDir: 'books/s',
      createdAt: 1,
      updatedAt: 1,
    },
    idea: '',
    genre: 'default',
    totalChapters: 10,
    world: null,
    characters: [],
    outline: [],
    chapters: [],
    currentChapterIndex: 0,
    foreshadowStack: [],
    chapterSummaries: [],
    storyState: { ...emptyState(), canonicalFacts },
  } as ReducedGraphState
}

const provider: ModelProvider = { chat: vi.fn() }

describe('buildChapterAgentContext chapterContract', () => {
  it('renders canonical fact sections with exact formatting (snapshot)', async () => {
    const facts: CanonicalFact[] = [
      makeFact({ id: 'p-1', subject: 'item-1', attribute: 'location', value: 'loc-b' }),
      makeFact({
        id: 'i-1',
        subject: 'c-2',
        attribute: 'known_info',
        value: '知道密信下落',
        source: 'outline_inference',
      }),
      makeFact({ id: 'p-2', subject: 'c-1', attribute: 'status', value: '受伤' }),
      makeFact({
        id: 'i-2',
        subject: 'item-2',
        attribute: 'holder',
        value: 'c-1',
        source: 'outline_inference',
      }),
      // 低置信度与已退休事实不得出现在契约中
      makeFact({ id: 'low-1', subject: 'c-3', value: 'loc-x', confidence: 'low' }),
      makeFact({ id: 'ret-1', subject: 'c-4', value: 'loc-y', retiredIn: 3 }),
    ]

    const context = await buildChapterAgentContext(makeGraphState(facts), 0, provider)

    expect(context.chapterContract).toMatchInlineSnapshot(`
      "【章节契约】
      【受保护权威事实】
      - [item-1] location: loc-b
      - [c-1] status: 受伤
      【大纲推断事实（提示级，正文/已确立事实优先）】
      - [c-2] known_info: 知道密信下落
      - [item-2] holder: c-1
      【执行要求】规划、正文与一致性检查必须优先满足本契约；如需改变受保护事实，必须由本章大纲明确授权并在正文中提供清晰动作或证据。"
    `)
  })

  it('caps protected facts to 20 and outline-inferred facts to 10', async () => {
    const protectedFacts = Array.from({ length: 22 }, (_, i) =>
      makeFact({ id: `p-${i}`, subject: `受保护${i}`, value: `值${i}` })
    )
    const inferredFacts = Array.from({ length: 12 }, (_, i) =>
      makeFact({
        id: `i-${i}`,
        subject: `推断${i}`,
        value: `值${i}`,
        source: 'outline_inference',
      })
    )

    const context = await buildChapterAgentContext(
      makeGraphState([...protectedFacts, ...inferredFacts]),
      0,
      provider
    )
    const contract = context.chapterContract!

    expect(contract).toContain('[受保护21]')
    expect(contract).toContain('[受保护2]')
    expect(contract).not.toContain('[受保护1]')
    expect(contract).not.toContain('[受保护0]')
    expect(contract).toContain('[推断11]')
    expect(contract).toContain('[推断2]')
    expect(contract).not.toContain('[推断1]')
    expect(contract).not.toContain('[推断0]')
  })
})
