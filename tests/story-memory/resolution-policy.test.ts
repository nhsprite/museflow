import { describe, expect, it } from 'vitest'
import { applyEvents, createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import * as resolutionPolicy from '../../src/story-memory/resolution-policy.js'
import type { ForeshadowResolutionPolicy, StoryMemory } from '../../src/types/story-memory.js'

describe('foreshadow resolution policy v2', () => {
  it('creates StoryMemory v2', () => {
    expect(createEmptyStoryMemory().version).toBe('2')
  })

  it('replays a legacy required null-deadline clue as should_resolve', () => {
    const memory = applyEvents(createEmptyStoryMemory(), [
      {
        id: 'evt-legacy-open-clue',
        type: 'foreshadow-introduce',
        foreshadowId: 'legacy-open-clue',
        expectedFulfillChapter: null,
        required: true,
        chapterIndex: 1,
        source: 'chapter',
      },
    ])

    expect(memory.foreshadows['legacy-open-clue']).toMatchObject({
      resolutionPolicy: 'should_resolve',
      required: true,
    })
  })

  it.each([
    [true, 12, 'must_resolve'],
    [false, 12, 'must_resolve'],
    [true, null, 'should_resolve'],
    [false, null, 'may_remain_open'],
  ] as const)('maps required=%s deadline=%s to %s', (required, deadline, expected) => {
    expect(resolutionPolicy.policyFromLegacyFields(required, deadline)).toBe(expected)
  })

  it('requires a finite deadline only for must_resolve', () => {
    const validate = (
      resolutionPolicy as unknown as {
        validatePolicyDeadline?: (
          policy: ForeshadowResolutionPolicy,
          deadline: number | null
        ) => boolean
      }
    ).validatePolicyDeadline

    expect(validate).toBeTypeOf('function')
    expect(validate?.('must_resolve', null)).toBe(false)
    expect(validate?.('must_resolve', 12)).toBe(true)
    expect(validate?.('should_resolve', null)).toBe(true)
    expect(validate?.('should_resolve', 12)).toBe(false)
  })

  it('migrates v1 once and preserves an explicit policy', () => {
    const migrate = (
      resolutionPolicy as unknown as {
        migrateStoryMemoryToV2?: (memory: unknown) => StoryMemory
      }
    ).migrateStoryMemoryToV2
    const v1 = {
      ...createEmptyStoryMemory(),
      version: '1',
      foreshadows: {
        deadline: {
          id: 'deadline',
          text: 'deadline',
          kind: null,
          introducedIn: 1,
          expectedFulfillChapter: 12,
          fulfilledIn: null,
          required: false,
          beatId: null,
        },
        open: {
          id: 'open',
          text: 'open',
          kind: null,
          introducedIn: 1,
          expectedFulfillChapter: null,
          fulfilledIn: null,
          required: true,
          beatId: null,
        },
        explicit: {
          id: 'explicit',
          text: 'explicit',
          kind: null,
          introducedIn: 1,
          expectedFulfillChapter: null,
          fulfilledIn: null,
          resolutionPolicy: 'may_remain_open',
          required: true,
          beatId: null,
        },
      },
    }

    expect(migrate).toBeTypeOf('function')
    const migrated = migrate?.(v1)
    expect(migrated?.version).toBe('2')
    expect(migrated?.foreshadows.deadline?.resolutionPolicy).toBe('must_resolve')
    expect(migrated?.foreshadows.open?.resolutionPolicy).toBe('should_resolve')
    expect(migrated?.foreshadows.explicit?.resolutionPolicy).toBe('may_remain_open')
    expect(migrate?.(migrated)).toBe(migrated)
  })
})
