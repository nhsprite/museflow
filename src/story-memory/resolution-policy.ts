import type {
  ForeshadowMemory,
  ForeshadowResolutionPolicy,
  StoryMemory,
} from '../types/story-memory.js'

export const FORESHADOW_RESOLUTION_POLICIES = [
  'must_resolve',
  'should_resolve',
  'may_remain_open',
] as const satisfies readonly ForeshadowResolutionPolicy[]

export interface LegacyForeshadowMemoryV1 extends Omit<ForeshadowMemory, 'resolutionPolicy'> {
  resolutionPolicy?: ForeshadowResolutionPolicy
}

export interface LegacyStoryMemoryV1 extends Omit<StoryMemory, 'version' | 'foreshadows'> {
  version: '1'
  foreshadows: Record<string, LegacyForeshadowMemoryV1>
}

export function policyFromLegacyFields(
  required: boolean | undefined,
  expectedFulfillChapter: number | null
): ForeshadowResolutionPolicy {
  if (Number.isInteger(expectedFulfillChapter)) return 'must_resolve'
  return required === false ? 'may_remain_open' : 'should_resolve'
}

export function isForeshadowResolutionPolicy(value: unknown): value is ForeshadowResolutionPolicy {
  return FORESHADOW_RESOLUTION_POLICIES.some((policy) => policy === value)
}

export function deriveLegacyRequired(policy: ForeshadowResolutionPolicy): boolean {
  return policy !== 'may_remain_open'
}

export function validatePolicyDeadline(
  policy: ForeshadowResolutionPolicy,
  deadline: number | null
): boolean {
  if (policy === 'must_resolve') {
    return deadline !== null && Number.isInteger(deadline) && deadline > 0
  }
  return deadline === null
}

export function migrateStoryMemoryToV2(memory: StoryMemory | LegacyStoryMemoryV1): StoryMemory {
  if (memory.version === '2') return memory

  const foreshadows = Object.fromEntries(
    Object.entries(memory.foreshadows).map(([id, item]) => {
      const resolutionPolicy =
        item.resolutionPolicy ?? policyFromLegacyFields(item.required, item.expectedFulfillChapter)
      return [
        id,
        {
          ...item,
          resolutionPolicy,
          required: deriveLegacyRequired(resolutionPolicy),
        },
      ]
    })
  )

  return {
    ...memory,
    version: '2',
    foreshadows,
  }
}
