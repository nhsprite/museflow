import { describe, it, expect, vi } from 'vitest'
import {
  repairCorruptedState,
  validateStateRepairProposal,
  type StateRepairProposal,
  type StateRepairValidationContext,
} from '../../../../src/graph/services/state-repair/index.js'
import { createEmptyStoryMemory } from '../../../../src/story-memory/projector.js'
import { createEmptyStoryState } from '../../../../src/storage/meta/stores/story-state.js'
import type { StoryMemory } from '../../../../src/types/story-memory.js'
import type { StoryState } from '../../../../src/types/story-state.js'
import type { Issue } from '../../../../src/types/agent.js'
import type { ModelProvider } from '../../../../src/model/provider.js'

function buildMemory(): StoryMemory {
  const memory = createEmptyStoryMemory()
  memory.entities.characters['c-1'] = {
    id: 'c-1',
    name: '甲',
    locationId: 'loc-a',
    status: {},
    introducedIn: 0,
  }
  memory.entities.items['item-1'] = {
    id: 'item-1',
    name: '旧盒',
    holderId: 'deeper',
    locationId: null,
    state: {},
    introducedIn: 0,
  }
  memory.entities.locations['loc-a'] = { id: 'loc-a', name: '前厅', introducedIn: 0 }
  memory.entities.locations['loc-b'] = { id: 'loc-b', name: '后屋', introducedIn: 0 }
  return memory
}

function buildState(overrides: Partial<StoryState> = {}): StoryState {
  return {
    ...createEmptyStoryState(),
    characterLocations: { 'c-1': 'loc-a' },
    keyItemsLocation: { 'item-1': 'deeper' },
    ...overrides,
  }
}

function buildValidationCtx(
  overrides: Partial<StateRepairValidationContext> = {}
): StateRepairValidationContext {
  return {
    knownEntityIds: new Set(['c-1', 'item-1', 'loc-a', 'loc-b']),
    locationEntityIds: new Set(['loc-a', 'loc-b']),
    characterEntityIds: new Set(['c-1']),
    itemEntityIds: new Set(['item-1']),
    storyState: buildState(),
    currentChapterIndex: 24,
    ...overrides,
  }
}

function makeProposal(overrides: Partial<StateRepairProposal> = {}): StateRepairProposal {
  return {
    subject: 'item-1',
    attribute: 'location',
    oldValue: 'deeper',
    newValue: 'loc-b',
    evidenceChapter: 20,
    rationale: '第 20 章正文明确旧盒已移至后屋',
    ...overrides,
  }
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    ruleId: 'test.state-corruption',
    type: 'consistency',
    severity: 'error',
    dimension: 'structured_state',
    description: '旧盒位置记录与第 25 章正文矛盾',
    ...overrides,
  }
}

describe('validateStateRepairProposal', () => {
  it('accepts a well-formed location proposal', () => {
    const verdict = validateStateRepairProposal(makeProposal(), buildValidationCtx())
    expect(verdict.accepted).toBe(true)
    expect(verdict.attribute).toBe('location')
  })

  it('rejects an unknown subject', () => {
    const verdict = validateStateRepairProposal(
      makeProposal({ subject: 'ghost-entity' }),
      buildValidationCtx()
    )
    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toContain('不是已知实体 id')
  })

  it('rejects an unrecognized attribute', () => {
    const verdict = validateStateRepairProposal(
      makeProposal({ attribute: '所在位置!!!' }),
      buildValidationCtx()
    )
    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toContain('属性枚举')
  })

  it('accepts a Chinese attribute label that maps to an enum', () => {
    const verdict = validateStateRepairProposal(
      makeProposal({ attribute: '所在位置' }),
      buildValidationCtx()
    )
    expect(verdict.accepted).toBe(true)
    expect(verdict.attribute).toBe('location')
  })

  it('rejects a location newValue that is not a known location id', () => {
    const verdict = validateStateRepairProposal(
      makeProposal({ newValue: 'nowhere' }),
      buildValidationCtx()
    )
    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toContain('不是该实体允许的 location id')
  })

  it('allows an item location newValue to be a known character id', () => {
    const verdict = validateStateRepairProposal(
      makeProposal({ newValue: 'c-1' }),
      buildValidationCtx()
    )
    expect(verdict.accepted).toBe(true)
  })

  it('rejects an oldValue that does not exactly equal the recorded value', () => {
    const verdict = validateStateRepairProposal(
      makeProposal({ oldValue: 'deeper ' }),
      buildValidationCtx()
    )
    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toContain('不精确相等')
  })

  it('rejects a proposal without a current recorded value', () => {
    const verdict = validateStateRepairProposal(
      makeProposal({ subject: 'c-1', attribute: 'origin', oldValue: 'unknown', newValue: 'x' }),
      buildValidationCtx()
    )
    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toContain('无记录值')
  })

  it('rejects an evidenceChapter in the current chapter', () => {
    const verdict = validateStateRepairProposal(
      makeProposal({ evidenceChapter: 25 }),
      buildValidationCtx()
    )
    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toContain('evidenceChapter')
  })

  it('rejects a non-integer evidenceChapter', () => {
    const verdict = validateStateRepairProposal(
      makeProposal({ evidenceChapter: 20.5 }),
      buildValidationCtx()
    )
    expect(verdict.accepted).toBe(false)
  })

  it('rejects a no-op proposal whose newValue equals the recorded value', () => {
    const verdict = validateStateRepairProposal(
      makeProposal({ attribute: 'holder', oldValue: 'deeper', newValue: 'deeper' }),
      buildValidationCtx()
    )
    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toContain('无需修复')
  })

  it('prefers the active canonical fact over the projection when checking oldValue', () => {
    const storyState = buildState({
      canonicalFacts: [
        {
          id: 'fact-1',
          subject: 'item-1',
          attribute: 'location',
          value: 'loc-a',
          establishedIn: 10,
          confidence: 'high',
          source: 'chapter_text',
        },
      ],
    })
    const ctx = buildValidationCtx({ storyState })
    expect(
      validateStateRepairProposal(makeProposal({ oldValue: 'deeper', newValue: 'loc-b' }), ctx)
        .accepted
    ).toBe(false)
    expect(
      validateStateRepairProposal(makeProposal({ oldValue: 'loc-a', newValue: 'loc-b' }), ctx)
        .accepted
    ).toBe(true)
  })
})

describe('repairCorruptedState', () => {
  it('filters relevant facts only by verified issue subjects', async () => {
    const provider: ModelProvider = {
      chat: vi.fn(),
      chatStructured: vi.fn().mockResolvedValue({ proposals: [] }),
    }
    const storyState = buildState({
      canonicalFacts: [
        {
          id: 'fact-subject',
          subject: 'c-1',
          attribute: 'status',
          value: 'SUBJECT_FACT_MARKER',
          establishedIn: 1,
        },
        {
          id: 'fact-actual-value',
          subject: 'item-1',
          attribute: 'status',
          value: 'ACTUAL_VALUE_FACT_MARKER',
          establishedIn: 1,
        },
        {
          id: 'fact-expected-value',
          subject: 'loc-b',
          attribute: 'status',
          value: 'EXPECTED_VALUE_FACT_MARKER',
          establishedIn: 1,
        },
      ],
    })

    await repairCorruptedState(
      {
        issues: [
          makeIssue({
            subject: 'c-1',
            actualValue: 'item-1',
            expectedValue: 'loc-b',
          }),
        ],
        storyState,
        storyMemory: buildMemory(),
        chapterSummaries: [],
        currentChapterIndex: 24,
      },
      provider
    )

    const messages = vi.mocked(provider.chatStructured!).mock.calls[0]?.[0] as Array<{
      role: string
      content: string
    }>
    const userMessage = messages.find((message) => message.role === 'user')?.content ?? ''
    const relatedFactsSection =
      userMessage.match(/【相关权威事实（按问题涉及的实体筛选）】([\s\S]*?)【已知实体 id】/)?.[1] ??
      ''
    expect(relatedFactsSection).toContain('SUBJECT_FACT_MARKER')
    expect(relatedFactsSection).not.toContain('ACTUAL_VALUE_FACT_MARKER')
    expect(relatedFactsSection).not.toContain('EXPECTED_VALUE_FACT_MARKER')
  })

  it('writes accepted proposals as state_repair canonical facts and merges them into storyState', async () => {
    const provider: ModelProvider = {
      chat: vi.fn(),
      chatStructured: vi.fn().mockResolvedValue({ proposals: [makeProposal()] }),
    }
    const storyState = buildState()
    const outcome = await repairCorruptedState(
      {
        issues: [makeIssue()],
        storyState,
        storyMemory: buildMemory(),
        chapterSummaries: ['第 20 章摘要'],
        currentChapterIndex: 24,
      },
      provider
    )

    expect(outcome.acceptedFacts).toHaveLength(1)
    const fact = outcome.acceptedFacts[0]!
    expect(fact.subject).toBe('item-1')
    expect(fact.attribute).toBe('location')
    expect(fact.value).toBe('loc-b')
    expect(fact.source).toBe('state_repair')
    expect(fact.confidence).toBe('high')
    expect(fact.establishedIn).toBe(24)
    expect(fact.evidence?.chapterIndex).toBe(19)

    const active = (outcome.storyState.canonicalFacts ?? []).filter(
      (f) => f.subject === 'item-1' && f.attribute === 'location' && f.retiredIn === undefined
    )
    expect(active).toHaveLength(1)
    expect(active[0]?.value).toBe('loc-b')
  })

  it('retires a conflicting active canonical fact when merging', async () => {
    const provider: ModelProvider = {
      chat: vi.fn(),
      chatStructured: vi.fn().mockResolvedValue({
        proposals: [makeProposal({ oldValue: 'loc-a', newValue: 'loc-b' })],
      }),
    }
    const storyState = buildState({
      canonicalFacts: [
        {
          id: 'fact-old',
          subject: 'item-1',
          attribute: 'location',
          value: 'loc-a',
          establishedIn: 5,
          confidence: 'high',
          source: 'chapter_text',
        },
      ],
    })
    const outcome = await repairCorruptedState(
      {
        issues: [makeIssue()],
        storyState,
        storyMemory: buildMemory(),
        chapterSummaries: [],
        currentChapterIndex: 24,
      },
      provider
    )

    const facts = outcome.storyState.canonicalFacts ?? []
    const oldFact = facts.find((f) => f.id === 'fact-old')
    expect(oldFact?.retiredIn).toBe(24)
    const active = facts.filter(
      (f) => f.subject === 'item-1' && f.attribute === 'location' && f.retiredIn === undefined
    )
    expect(active).toHaveLength(1)
    expect(active[0]?.value).toBe('loc-b')
  })

  it('does not touch state when every proposal is rejected', async () => {
    const provider: ModelProvider = {
      chat: vi.fn(),
      chatStructured: vi.fn().mockResolvedValue({
        proposals: [
          makeProposal({ subject: 'ghost' }),
          makeProposal({ oldValue: 'wrong' }),
          makeProposal({ evidenceChapter: 25 }),
        ],
      }),
    }
    const storyState = buildState()
    const outcome = await repairCorruptedState(
      {
        issues: [makeIssue()],
        storyState,
        storyMemory: buildMemory(),
        chapterSummaries: [],
        currentChapterIndex: 24,
      },
      provider
    )

    expect(outcome.acceptedFacts).toHaveLength(0)
    expect(outcome.rejectedCount).toBe(3)
    expect(outcome.storyState).toBe(storyState)
  })

  it('returns early without calling the provider when storyMemory is missing', async () => {
    const provider: ModelProvider = {
      chat: vi.fn(),
      chatStructured: vi.fn(),
    }
    const storyState = buildState()
    const outcome = await repairCorruptedState(
      {
        issues: [makeIssue()],
        storyState,
        storyMemory: null,
        chapterSummaries: [],
        currentChapterIndex: 24,
      },
      provider
    )

    expect(outcome.acceptedFacts).toHaveLength(0)
    expect(outcome.storyState).toBe(storyState)
    expect(provider.chatStructured).not.toHaveBeenCalled()
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('falls back to chat JSON parsing when chatStructured is unavailable', async () => {
    const provider: ModelProvider = {
      chat: vi
        .fn()
        .mockResolvedValue('```json\n' + JSON.stringify({ proposals: [makeProposal()] }) + '\n```'),
    }
    const outcome = await repairCorruptedState(
      {
        issues: [makeIssue()],
        storyState: buildState(),
        storyMemory: buildMemory(),
        chapterSummaries: [],
        currentChapterIndex: 24,
      },
      provider
    )

    expect(provider.chat).toHaveBeenCalled()
    expect(outcome.acceptedFacts).toHaveLength(1)
  })

  it('keeps state unchanged when the provider throws', async () => {
    const provider: ModelProvider = {
      chat: vi.fn(),
      chatStructured: vi.fn().mockRejectedValue(new Error('model down')),
    }
    const storyState = buildState()
    const outcome = await repairCorruptedState(
      {
        issues: [makeIssue()],
        storyState,
        storyMemory: buildMemory(),
        chapterSummaries: [],
        currentChapterIndex: 24,
      },
      provider
    )

    expect(outcome.acceptedFacts).toHaveLength(0)
    expect(outcome.storyState).toBe(storyState)
  })

  it('returns structured rejection feedback with reasons for rejected proposals', async () => {
    const provider: ModelProvider = {
      chat: vi.fn(),
      chatStructured: vi.fn().mockResolvedValue({
        proposals: [
          makeProposal({ subject: 'ghost' }),
          makeProposal({ oldValue: 'wrong' }),
          makeProposal(),
        ],
      }),
    }
    const outcome = await repairCorruptedState(
      {
        issues: [makeIssue()],
        storyState: buildState(),
        storyMemory: buildMemory(),
        chapterSummaries: [],
        currentChapterIndex: 24,
      },
      provider
    )

    expect(outcome.acceptedFacts).toHaveLength(1)
    expect(outcome.rejectionFeedback).toHaveLength(2)
    expect(outcome.rejectionFeedback[0]).toContain('ghost/location')
    expect(outcome.rejectionFeedback[0]).toContain('不是已知实体 id')
    expect(outcome.rejectionFeedback[1]).toContain('不精确相等')
  })

  it('feeds previous rejection feedback back into the repair prompt', async () => {
    const provider: ModelProvider = {
      chat: vi.fn(),
      chatStructured: vi.fn().mockResolvedValue({ proposals: [makeProposal()] }),
    }
    await repairCorruptedState(
      {
        issues: [makeIssue()],
        storyState: buildState(),
        storyMemory: buildMemory(),
        chapterSummaries: [],
        currentChapterIndex: 24,
        previousRejections: ['item-1/location: deeper → loc-b（oldValue 与当前记录值不精确相等）'],
      },
      provider
    )

    const calls = vi.mocked(provider.chatStructured!).mock.calls
    const messages = calls[0]?.[0] as Array<{ role: string; content: string }>
    const userMessage = messages.find((m) => m.role === 'user')
    expect(userMessage?.content).toContain('上轮被拒提案及原因')
    expect(userMessage?.content).toContain('item-1/location: deeper → loc-b')
  })

  it('omits the rejection section when there is no previous feedback', async () => {
    const provider: ModelProvider = {
      chat: vi.fn(),
      chatStructured: vi.fn().mockResolvedValue({ proposals: [makeProposal()] }),
    }
    await repairCorruptedState(
      {
        issues: [makeIssue()],
        storyState: buildState(),
        storyMemory: buildMemory(),
        chapterSummaries: [],
        currentChapterIndex: 24,
      },
      provider
    )

    const calls = vi.mocked(provider.chatStructured!).mock.calls
    const messages = calls[0]?.[0] as Array<{ role: string; content: string }>
    const userMessage = messages.find((m) => m.role === 'user')
    expect(userMessage?.content).not.toContain('上轮被拒提案及原因')
  })
})
