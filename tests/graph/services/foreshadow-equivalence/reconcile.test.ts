import { describe, expect, it, vi } from 'vitest'
import type { ModelProvider } from '../../../../src/model/provider.js'
import {
  FORESHADOW_EQUIVALENCE_AUDIT_PROTOCOL_VERSION,
  type ForeshadowEquivalenceAudit,
} from '../../../../src/graph/state.js'
import { reconcileForeshadowEquivalence } from '../../../../src/graph/services/foreshadow-equivalence/reconcile.js'
import { ForeshadowEquivalenceError } from '../../../../src/graph/services/foreshadow-equivalence/detector.js'
import { resolveCanonicalForeshadowId } from '../../../../src/story-memory/foreshadow-alias.js'
import { applyEvents, createEmptyStoryMemory } from '../../../../src/story-memory/projector.js'
import type { ForeshadowId, StoryEvent, StoryMemory } from '../../../../src/types/story-memory.js'

type ForeshadowIntroduceEvent = Extract<StoryEvent, { type: 'foreshadow-introduce' }>

function introduce(
  foreshadowId: ForeshadowId,
  chapterIndex: number,
  text = `text-${foreshadowId}`,
  kind: ForeshadowIntroduceEvent['kind'] | null = 'plot'
): ForeshadowIntroduceEvent {
  return {
    id: `introduce-${foreshadowId}`,
    type: 'foreshadow-introduce',
    foreshadowId,
    text,
    ...(kind !== null ? { kind } : {}),
    expectedFulfillChapter: null,
    resolutionPolicy: 'should_resolve',
    chapterIndex,
    source: 'outline',
  }
}

function memoryWith(...events: StoryEvent[]): StoryMemory {
  return applyEvents(createEmptyStoryMemory(), events)
}

function providerWithGroups(groups: unknown[]): ModelProvider {
  return {
    chat: vi.fn(),
    chatStructured: vi.fn().mockResolvedValue({ groups }),
  }
}

function audit(activeCanonicalIds: ForeshadowId[]): ForeshadowEquivalenceAudit {
  return {
    protocolVersion: FORESHADOW_EQUIVALENCE_AUDIT_PROTOCOL_VERSION,
    activeCanonicalIds,
  }
}

describe('reconcileForeshadowEquivalence', () => {
  it('merges every valid detector group and is idempotent through the refreshed audit', async () => {
    const memory = memoryWith(introduce('fs-a', 0), introduce('fs-b', 1))
    const provider = providerWithGroups([
      { ids: ['fs-b', 'fs-a'], reason: 'same unresolved obligation' },
    ])

    const first = await reconcileForeshadowEquivalence({
      provider,
      memory,
      chapterIndex: 2,
    })
    const second = await reconcileForeshadowEquivalence({
      provider,
      memory: first.memory,
      chapterIndex: 2,
      audit: first.audit,
    })

    expect(first.mergeEvents).toMatchObject([
      {
        type: 'foreshadow-merge',
        source: 'outline',
        chapterIndex: 2,
        canonicalForeshadowId: 'fs-a',
        duplicateForeshadowId: 'fs-b',
        reason: 'same unresolved obligation',
      },
    ])
    expect(resolveCanonicalForeshadowId(first.memory, 'fs-b')).toBe('fs-a')
    expect(first.audit).toEqual(audit(['fs-a']))
    expect(second.memory).toBe(first.memory)
    expect(second.mergeEvents).toEqual([])
    expect(provider.chatStructured).toHaveBeenCalledTimes(1)
  })

  it('skips detection when protocol and ordered active canonical IDs match', async () => {
    const memory = memoryWith(introduce('fs-a', 0), introduce('fs-b', 1))
    const provider = providerWithGroups([])

    const result = await reconcileForeshadowEquivalence({
      provider,
      memory,
      chapterIndex: 2,
      audit: audit(['fs-a', 'fs-b']),
    })

    expect(result.memory).toBe(memory)
    expect(result.audit).toEqual(audit(['fs-a', 'fs-b']))
    expect(result.mergeEvents).toEqual([])
    expect(provider.chatStructured).not.toHaveBeenCalled()
  })

  it.each([
    ['protocol version', { protocolVersion: 0, activeCanonicalIds: ['fs-a', 'fs-b'] }],
    ['active ID order', audit(['fs-b', 'fs-a'])],
    ['active ID set', audit(['fs-a'])],
  ])('invalidates a stale audit when the %s differs', async (_label, staleAudit) => {
    const memory = memoryWith(introduce('fs-a', 0), introduce('fs-b', 1))
    const provider = providerWithGroups([])

    await reconcileForeshadowEquivalence({
      provider,
      memory,
      chapterIndex: 2,
      audit: staleAudit as ForeshadowEquivalenceAudit,
    })

    expect(provider.chatStructured).toHaveBeenCalledTimes(1)
  })

  it('returns a refreshed audit when the detector finds no groups', async () => {
    const memory = memoryWith(introduce('fs-a', 0), introduce('fs-b', 1))
    const provider = providerWithGroups([])

    const result = await reconcileForeshadowEquivalence({
      provider,
      memory,
      chapterIndex: 2,
    })

    expect(result.memory).toBe(memory)
    expect(result.mergeEvents).toEqual([])
    expect(result.audit).toEqual(audit(['fs-a', 'fs-b']))
    expect(provider.chatStructured).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['zero', createEmptyStoryMemory(), []],
    ['one', memoryWith(introduce('fs-only', 0)), ['fs-only']],
  ])('does not call the provider for %s candidates', async (_label, memory, ids) => {
    const provider = providerWithGroups([])

    const result = await reconcileForeshadowEquivalence({
      provider,
      memory,
      chapterIndex: 1,
    })

    expect(result.audit).toEqual(audit(ids))
    expect(result.mergeEvents).toEqual([])
    expect(provider.chatStructured).not.toHaveBeenCalled()
  })

  it('normalizes group, member, and edge order by structural introduction order', async () => {
    const memory = memoryWith(
      introduce('fs-a', 1),
      introduce('fs-b', 1),
      introduce('fs-c', 2),
      introduce('fs-d', 2),
      introduce('fs-e', 3)
    )
    const provider = providerWithGroups([
      { ids: ['fs-e', 'fs-c', 'fs-d'], reason: 'later group' },
      { ids: ['fs-b', 'fs-a'], reason: 'earlier group' },
    ])

    const result = await reconcileForeshadowEquivalence({
      provider,
      memory,
      chapterIndex: 4,
    })

    expect(
      result.mergeEvents.map((event) => [
        event.canonicalForeshadowId,
        event.duplicateForeshadowId,
        event.reason,
      ])
    ).toEqual([
      ['fs-a', 'fs-b', 'earlier group'],
      ['fs-c', 'fs-d', 'later group'],
      ['fs-c', 'fs-e', 'later group'],
    ])
    expect(result.audit).toEqual(audit(['fs-a', 'fs-c']))
  })

  it('applies non-foreshadow proposed events before taking an audit skip', async () => {
    const memory = memoryWith(introduce('fs-a', 0), introduce('fs-b', 1))
    const taskEvent: StoryEvent = {
      id: 'create-task',
      type: 'task-create',
      taskId: 'task-1',
      description: 'an open task',
      chapterIndex: 2,
      source: 'outline',
    }
    const provider = providerWithGroups([])

    const result = await reconcileForeshadowEquivalence({
      provider,
      memory,
      chapterIndex: 2,
      audit: audit(['fs-a', 'fs-b']),
      proposedEvents: [taskEvent],
    })

    expect(result.memory.events.at(-1)).toEqual(taskEvent)
    expect(result.memory.tasks['task-1']?.description).toBe('an open task')
    expect(provider.chatStructured).not.toHaveBeenCalled()
  })

  it('includes a newly introduced candidate even when it is fulfilled in the proposed batch', async () => {
    const memory = memoryWith(introduce('fs-a', 0, 'first record'))
    const proposed: StoryEvent[] = [
      introduce('fs-b', 2, 'duplicate record'),
      {
        id: 'fulfill-fs-b',
        type: 'foreshadow-fulfill',
        foreshadowId: 'fs-b',
        chapterIndex: 2,
        source: 'chapter',
      },
    ]
    const provider = providerWithGroups([
      { ids: ['fs-b', 'fs-a'], reason: 'one immediately resolved obligation' },
    ])

    const result = await reconcileForeshadowEquivalence({
      provider,
      memory,
      chapterIndex: 2,
      audit: audit(['fs-a']),
      proposedEvents: proposed,
    })

    expect(result.mergeEvents).toHaveLength(1)
    expect(result.memory.foreshadows['fs-a']?.fulfilledIn).toBe(2)
    expect(resolveCanonicalForeshadowId(result.memory, 'fs-b')).toBe('fs-a')
    expect(result.audit).toEqual(audit([]))
  })

  it('sends exact candidate fields with 1-based display introduction chapters', async () => {
    const memory = memoryWith(
      introduce('fs-a', 0, 'first exact text', 'dialogue_hint'),
      introduce('fs-b', 3, 'second exact text', null)
    )
    const provider = providerWithGroups([])

    await reconcileForeshadowEquivalence({ provider, memory, chapterIndex: 4 })

    const messages = vi.mocked(provider.chatStructured!).mock.calls[0]?.[0]
    const userPayload = JSON.parse(messages?.[1]?.content.split('\n').slice(1).join('\n') ?? '[]')
    expect(userPayload).toEqual([
      {
        id: 'fs-a',
        text: 'first exact text',
        kind: 'dialogue_hint',
        introducedChapter: 1,
      },
      {
        id: 'fs-b',
        text: 'second exact text',
        kind: null,
        introducedChapter: 4,
      },
    ])
  })

  it('rethrows detector errors unchanged and leaves all inputs untouched', async () => {
    const memory = memoryWith(introduce('fs-a', 0), introduce('fs-b', 1))
    const inputSnapshot = structuredClone(memory)
    const inputAudit = audit(['stale-id'])
    const auditSnapshot = structuredClone(inputAudit)
    const proposed: StoryEvent[] = [
      {
        id: 'create-task',
        type: 'task-create',
        taskId: 'task-1',
        description: 'an open task',
        chapterIndex: 2,
        source: 'outline',
      },
    ]
    const proposedSnapshot = structuredClone(proposed)
    const provider = providerWithGroups([{ ids: ['fs-a', 'unknown'], reason: 'invalid' }])

    let thrown: unknown
    try {
      await reconcileForeshadowEquivalence({
        provider,
        memory,
        chapterIndex: 2,
        audit: inputAudit,
        proposedEvents: proposed,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ForeshadowEquivalenceError)
    expect(memory).toEqual(inputSnapshot)
    expect(inputAudit).toEqual(auditSnapshot)
    expect(proposed).toEqual(proposedSnapshot)
  })

  it('wraps projector merge validation failures and leaves all inputs untouched', async () => {
    const memory = memoryWith(introduce('fs-a', 0), introduce('fs-b', 1))
    const inputSnapshot = structuredClone(memory)
    const inputAudit = audit(['fs-a', 'fs-b'])
    const auditSnapshot = structuredClone(inputAudit)
    const proposed: StoryEvent[] = [
      {
        id: 'invalid-merge',
        type: 'foreshadow-merge',
        canonicalForeshadowId: 'fs-b',
        duplicateForeshadowId: 'fs-a',
        reason: 'invalid structural order',
        chapterIndex: 2,
        source: 'outline',
      },
    ]
    const proposedSnapshot = structuredClone(proposed)

    await expect(
      reconcileForeshadowEquivalence({
        provider: providerWithGroups([]),
        memory,
        chapterIndex: 2,
        audit: inputAudit,
        proposedEvents: proposed,
      })
    ).rejects.toMatchObject({
      name: 'ForeshadowEquivalenceError',
      cause: { name: 'ForeshadowMergeValidationError' },
    })
    expect(memory).toEqual(inputSnapshot)
    expect(inputAudit).toEqual(auditSnapshot)
    expect(proposed).toEqual(proposedSnapshot)
  })
})
