import { describe, expect, it } from 'vitest'
import { applyEvents, createEmptyStoryMemory } from '../../src/story-memory/projector.js'
import {
  migrateStoryMemoryToV3,
  type LegacyStoryMemoryV1,
  type LegacyStoryMemoryV2,
} from '../../src/story-memory/resolution-policy.js'
import * as resolutionPolicy from '../../src/story-memory/resolution-policy.js'
import type { ForeshadowResolutionPolicy, StoryMemory } from '../../src/types/story-memory.js'

describe('foreshadow resolution policy v3', () => {
  it('creates StoryMemory v3', () => {
    expect(createEmptyStoryMemory().version).toBe('3')
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
    [true, 12, 'must_resolve', 12],
    [false, 12, 'may_remain_open', null],
    [true, null, 'should_resolve', null],
    [false, null, 'may_remain_open', null],
    [undefined, 12, 'must_resolve', 12],
    [undefined, null, 'should_resolve', null],
  ] as const)(
    'normalizes required=%s deadline=%s to %s/%s',
    (required, deadline, expectedPolicy, expectedDeadline) => {
      expect(resolutionPolicy.policyFromLegacyFields(required, deadline)).toBe(expectedPolicy)
      expect(
        (
          resolutionPolicy as unknown as {
            normalizeLegacyForeshadowFields: (
              required: boolean | undefined,
              deadline: number | null
            ) => {
              resolutionPolicy: ForeshadowResolutionPolicy
              expectedFulfillChapter: number | null
            }
          }
        ).normalizeLegacyForeshadowFields(required, deadline)
      ).toEqual({
        resolutionPolicy: expectedPolicy,
        expectedFulfillChapter: expectedDeadline,
      })
    }
  )

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

  it('migrates v1 through the existing field normalization without inventing aliases', () => {
    const v1: LegacyStoryMemoryV1 = {
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

    const migrated = migrateStoryMemoryToV3(v1)
    expect(migrated.version).toBe('3')
    expect(migrated.foreshadows.deadline).toMatchObject({
      resolutionPolicy: 'may_remain_open',
      expectedFulfillChapter: null,
      required: false,
    })
    expect(migrated.foreshadows.open?.resolutionPolicy).toBe('should_resolve')
    expect(migrated.foreshadows.explicit?.resolutionPolicy).toBe('may_remain_open')
    expect(migrated.foreshadows.deadline).not.toHaveProperty('mergedInto')
    expect(migrated.foreshadows.open).not.toHaveProperty('mergedInto')
    expect(migrated.foreshadows.explicit).not.toHaveProperty('mergedInto')
  })

  it('migrates v2 by changing only the version and preserves v3 by reference', () => {
    const v2: LegacyStoryMemoryV2 = {
      ...createEmptyStoryMemory(),
      version: '2',
      foreshadows: {
        existing: {
          id: 'existing',
          text: 'An existing unresolved clue.',
          kind: null,
          introducedIn: 1,
          expectedFulfillChapter: null,
          fulfilledIn: null,
          resolutionPolicy: 'should_resolve',
          required: true,
          beatId: null,
        },
      },
    }

    const migrated = migrateStoryMemoryToV3(v2)

    expect(migrated).toEqual({ ...v2, version: '3' })
    expect(migrated.foreshadows.existing).not.toHaveProperty('mergedInto')
    expect(migrateStoryMemoryToV3(migrated)).toBe(migrated)
  })
})
