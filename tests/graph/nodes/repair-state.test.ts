import { describe, it, expect, vi } from 'vitest'
import { repair_state } from '../../../src/graph/nodes/repair-state.js'
import { createEmptyStoryMemory } from '../../../src/story-memory/projector.js'
import { createEmptyStoryState } from '../../../src/storage/meta/stores/story-state.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import type { RuntimeContext } from '../../../src/core/context.js'
import type { Issue } from '../../../src/types/agent.js'
import { DEFAULT_CONFIG } from '../../../src/types/config.js'
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'

function buildContext(proposals: unknown): RuntimeContext {
  return {
    provider: {
      chat: vi.fn(),
      chatStructured: vi.fn().mockResolvedValue({ proposals }),
    },
    checkpointer: {} as unknown as BaseCheckpointSaver<string>,
    config: DEFAULT_CONFIG,
  }
}

function buildMemory() {
  const memory = createEmptyStoryMemory()
  memory.entities.items['item-1'] = {
    id: 'item-1',
    name: '旧盒',
    holderId: 'deeper',
    locationId: null,
    state: {},
    introducedIn: 0,
  }
  memory.entities.locations['loc-b'] = { id: 'loc-b', name: '后屋', introducedIn: 0 }
  return memory
}

function stateCorruptionIssue(id: string): Issue {
  return {
    id,
    type: 'consistency',
    severity: 'error',
    dimension: 'structured_state',
    description: '旧盒位置记录与已定稿章节正文矛盾',
  }
}

function buildState(issues: Issue[]): ReducedGraphState {
  return {
    currentChapterIndex: 24,
    pendingIssues: issues,
    storyState: {
      ...createEmptyStoryState(),
      keyItemsLocation: { 'item-1': 'deeper' },
    },
    storyMemory: buildMemory(),
    chapterSummaries: [],
    canonicalFactsDelta: undefined,
  } as ReducedGraphState
}

describe('repair_state node', () => {
  it('writes accepted facts into storyState and canonicalFactsDelta, and clears repaired issues', async () => {
    const issues = [
      stateCorruptionIssue('e1'),
      {
        id: 'w1',
        type: 'consistency' as const,
        severity: 'warning' as const,
        dimension: 'quality',
        description: '表达质量警告',
      },
    ]
    const state = buildState(issues)
    const context = buildContext([
      {
        subject: 'item-1',
        attribute: 'location',
        oldValue: 'deeper',
        newValue: 'loc-b',
        evidenceChapter: 20,
        rationale: '第 20 章正文明确旧盒已移至后屋',
      },
    ])

    const update = await repair_state(context, state)

    const facts = update.storyState?.canonicalFacts ?? []
    expect(facts.some((f) => f.source === 'state_repair' && f.value === 'loc-b')).toBe(true)
    expect(update.canonicalFactsDelta).toHaveLength(1)
    expect(update.canonicalFactsDelta?.[0]?.source).toBe('state_repair')
    expect(update.pendingIssues?.map((i) => i.id)).toEqual(['w1'])
  })

  it('appends to an existing canonicalFactsDelta instead of replacing it', async () => {
    const state = {
      ...buildState([stateCorruptionIssue('e1')]),
      canonicalFactsDelta: [
        {
          id: 'fact-prev',
          subject: 'c-1',
          attribute: 'status' as const,
          value: '受伤',
          establishedIn: 24,
          confidence: 'high' as const,
          source: 'reconciliation' as const,
        },
      ],
    } as ReducedGraphState
    const context = buildContext([
      {
        subject: 'item-1',
        attribute: 'location',
        oldValue: 'deeper',
        newValue: 'loc-b',
        evidenceChapter: 20,
        rationale: '正文证据',
      },
    ])

    const update = await repair_state(context, state)

    expect(update.canonicalFactsDelta).toHaveLength(2)
    expect(update.canonicalFactsDelta?.[0]?.id).toBe('fact-prev')
    expect(update.canonicalFactsDelta?.[1]?.source).toBe('state_repair')
  })

  it('returns no state change when all proposals are rejected', async () => {
    const issues = [stateCorruptionIssue('e1')]
    const state = buildState(issues)
    const context = buildContext([
      {
        subject: 'unknown-entity',
        attribute: 'location',
        oldValue: 'deeper',
        newValue: 'loc-b',
        evidenceChapter: 20,
        rationale: '无',
      },
    ])

    const update = await repair_state(context, state)

    expect(update.storyState).toBeUndefined()
    expect(update.canonicalFactsDelta).toBeUndefined()
    expect(update.pendingIssues).toBeUndefined()
  })

  it('returns no state change when there are no state-corruption issues', async () => {
    const state = buildState([
      {
        id: 'e1',
        type: 'consistency',
        severity: 'error',
        dimension: 'causality',
        description: '因果关系不连贯',
      },
    ])
    const context = buildContext([])

    const update = await repair_state(context, state)

    expect(update.storyState).toBeUndefined()
    expect(context.provider.chatStructured).not.toHaveBeenCalled()
  })

  it('writes rejection feedback back into the session for the next attempt', async () => {
    const state = {
      ...buildState([stateCorruptionIssue('e1')]),
      session: {
        chapterIndex: 24,
        rewriteAttempts: 2,
        errorRewriteAttempts: 1,
        autoFixAttempts: 0,
        previousIssues: [],
        previousRawErrorCount: 0,
        routingDecision: 'repair_state' as const,
        forceStructuralRewrite: false,
        rewriteApproved: true,
        issueFingerprintHistory: [],
        stateRepairAttempts: 1,
      },
    } as ReducedGraphState
    const context = buildContext([
      {
        subject: 'unknown-entity',
        attribute: 'location',
        oldValue: 'deeper',
        newValue: 'loc-b',
        evidenceChapter: 20,
        rationale: '无',
      },
    ])

    const update = await repair_state(context, state)

    expect(update.storyState).toBeUndefined()
    expect(update.session?.stateRepairAttempts).toBe(1)
    expect(update.session?.stateRepairRejections).toHaveLength(1)
    expect(update.session?.stateRepairRejections?.[0]).toContain('unknown-entity/location')
    expect(update.session?.stateRepairRejections?.[0]).toContain('不是已知实体 id')
  })

  it('passes previous rejection feedback into the next repair prompt', async () => {
    const state = {
      ...buildState([stateCorruptionIssue('e1')]),
      session: {
        chapterIndex: 24,
        rewriteAttempts: 2,
        errorRewriteAttempts: 1,
        autoFixAttempts: 0,
        previousIssues: [],
        previousRawErrorCount: 0,
        routingDecision: 'repair_state' as const,
        forceStructuralRewrite: false,
        rewriteApproved: true,
        issueFingerprintHistory: [],
        stateRepairAttempts: 1,
        stateRepairRejections: [
          'item-1/location: deeper → loc-b（oldValue 与当前记录值不精确相等）',
        ],
      },
    } as ReducedGraphState
    const context = buildContext([
      {
        subject: 'item-1',
        attribute: 'location',
        oldValue: 'deeper',
        newValue: 'loc-b',
        evidenceChapter: 20,
        rationale: '修正后的提案',
      },
    ])

    const update = await repair_state(context, state)

    const calls = vi.mocked(context.provider.chatStructured!).mock.calls
    const messages = calls[0]?.[0] as Array<{ role: string; content: string }>
    const userMessage = messages.find((m) => m.role === 'user')
    expect(userMessage?.content).toContain('上轮被拒提案及原因')
    expect(userMessage?.content).toContain('item-1/location: deeper → loc-b')
    expect(update.session?.stateRepairRejections).toEqual([])
  })
})
