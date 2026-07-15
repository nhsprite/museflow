import { describe, expect, it } from 'vitest'
import { rebuildStoryMemoryVerifiedConstraints } from '../../src/utils/story-memory-constraints.js'
import { applyEvents, createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import {
  foreshadowMemoryToItem,
  projectForeshadowStack,
} from '../../src/story-memory/foreshadow-policy.js'
import type { StoryEvent } from '../../src/types/story-memory.js'
import type { VerifiedConstraint } from '../../src/types/verified-constraint.js'

function buildMemory() {
  const events: StoryEvent[] = [
    {
      id: 'introduce-root',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-root',
      text: 'canonical obligation',
      expectedFulfillChapter: 5,
      resolutionPolicy: 'must_resolve',
      chapterIndex: 0,
      source: 'outline',
    },
    {
      id: 'introduce-alias',
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-alias',
      text: 'duplicate obligation',
      expectedFulfillChapter: 5,
      resolutionPolicy: 'must_resolve',
      chapterIndex: 1,
      source: 'outline',
    },
    {
      id: 'merge-alias',
      type: 'foreshadow-merge',
      canonicalForeshadowId: 'fs-root',
      duplicateForeshadowId: 'fs-alias',
      reason: 'same obligation',
      chapterIndex: 2,
      source: 'outline',
    },
    {
      id: 'create-task',
      type: 'task-create',
      taskId: 'task-open',
      description: 'open task description',
      chapterIndex: 0,
      source: 'outline',
    },
  ]
  const memory = applyEvents(createEmptyStoryMemory(), events)
  return {
    ...memory,
    beats: {
      'beat-open': {
        id: 'beat-open',
        description: 'unproven beat description',
        actIndex: 1,
        deadlineAct: 1,
        required: true,
        claimedIn: null,
        provenByEventIds: [],
      },
    },
  }
}

describe('rebuildStoryMemoryVerifiedConstraints', () => {
  it('rebuilds canonical memory and boundary constraints while preserving unrelated constraints', () => {
    const memory = buildMemory()
    const stack = [
      ...projectForeshadowStack(memory),
      foreshadowMemoryToItem(memory.foreshadows['fs-alias']!),
    ]
    const unrelated: VerifiedConstraint[] = [
      { kind: 'generic', id: 'manual:keep', text: 'manual constraint' },
      { kind: 'generic', text: 'routing constraint' },
      { kind: 'act_pressure', actIndex: 1, text: 'act pressure' },
    ]
    const existing: VerifiedConstraint[] = [
      ...unrelated,
      { kind: 'generic', id: 'memory:foreshadow:fs-root', text: 'stale root' },
      { kind: 'generic', id: 'memory:foreshadow:fs-alias', text: 'stale alias' },
      { kind: 'generic', id: 'memory:task:task-old', text: 'stale task' },
      { kind: 'generic', id: 'foreshadow-boundary:fs-root', text: 'stale boundary root' },
      { kind: 'generic', id: 'foreshadow-boundary:fs-alias', text: 'stale boundary alias' },
    ]

    const result = rebuildStoryMemoryVerifiedConstraints({
      existingConstraints: existing,
      memory,
      foreshadowStack: stack,
      foreshadowStackSource: 'canonical_memory',
      currentChapter: 2,
    })

    expect(result.slice(0, unrelated.length)).toEqual(unrelated)
    expect(
      result.filter((entry) => entry.kind === 'generic' && entry.id === 'memory:foreshadow:fs-root')
    ).toEqual([
      {
        kind: 'generic',
        id: 'memory:foreshadow:fs-root',
        text: '未回收伏笔 [fs-root]: canonical obligation',
      },
    ])
    expect(
      result.some((entry) => entry.kind === 'generic' && entry.id === 'memory:foreshadow:fs-alias')
    ).toBe(false)
    expect(
      result.some((entry) => entry.kind === 'generic' && entry.id === 'memory:task:task-open')
    ).toBe(true)
    expect(
      result.some((entry) => entry.kind === 'generic' && entry.id === 'memory:beat:beat-open')
    ).toBe(true)
    expect(
      result.filter(
        (entry) => entry.kind === 'generic' && entry.id === 'foreshadow-boundary:fs-root'
      )
    ).toHaveLength(1)
    expect(
      result.some(
        (entry) => entry.kind === 'generic' && entry.id === 'foreshadow-boundary:fs-alias'
      )
    ).toBe(false)
    expect(
      result.some((entry) => entry.kind === 'generic' && entry.id === 'memory:task:task-old')
    ).toBe(false)
  })

  it('uses the supplied display chapter for boundary regeneration', () => {
    const memory = buildMemory()
    const stack = projectForeshadowStack(memory)

    const beforeDeadline = rebuildStoryMemoryVerifiedConstraints({
      existingConstraints: [],
      memory,
      foreshadowStack: stack,
      foreshadowStackSource: 'canonical_memory',
      currentChapter: 4,
    })
    const atDeadline = rebuildStoryMemoryVerifiedConstraints({
      existingConstraints: beforeDeadline,
      memory,
      foreshadowStack: stack,
      foreshadowStackSource: 'canonical_memory',
      currentChapter: 5,
    })

    expect(
      beforeDeadline.some(
        (entry) => entry.kind === 'generic' && entry.id === 'foreshadow-boundary:fs-root'
      )
    ).toBe(true)
    expect(
      atDeadline.some(
        (entry) => entry.kind === 'generic' && entry.id === 'foreshadow-boundary:fs-root'
      )
    ).toBe(false)
  })
})
