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

export interface LegacyStoryMemoryV2 extends Omit<StoryMemory, 'version'> {
  version: '2'
}

export interface NormalizedLegacyForeshadowFields {
  resolutionPolicy: ForeshadowResolutionPolicy
  expectedFulfillChapter: number | null
}

export function normalizeLegacyForeshadowFields(
  required: boolean | undefined,
  expectedFulfillChapter: number | null
): NormalizedLegacyForeshadowFields {
  if (required === false) {
    return {
      resolutionPolicy: 'may_remain_open',
      expectedFulfillChapter: null,
    }
  }
  if (Number.isInteger(expectedFulfillChapter)) {
    return {
      resolutionPolicy: 'must_resolve',
      expectedFulfillChapter,
    }
  }
  return {
    resolutionPolicy: 'should_resolve',
    expectedFulfillChapter: null,
  }
}

export function policyFromLegacyFields(
  required: boolean | undefined,
  expectedFulfillChapter: number | null
): ForeshadowResolutionPolicy {
  return normalizeLegacyForeshadowFields(required, expectedFulfillChapter).resolutionPolicy
}

export function policyFromLegacyStackFields(
  required: boolean | undefined,
  expectedFulfillChapter: number
): ForeshadowResolutionPolicy {
  const deadline = expectedFulfillChapter >= Number.MAX_SAFE_INTEGER ? null : expectedFulfillChapter
  return policyFromLegacyFields(required, deadline)
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

function migrateStoryMemoryV1ToV2(memory: LegacyStoryMemoryV1): LegacyStoryMemoryV2 {
  const foreshadows = Object.fromEntries(
    Object.entries(memory.foreshadows).map(([id, item]) => {
      const normalized = item.resolutionPolicy
        ? {
            resolutionPolicy: item.resolutionPolicy,
            expectedFulfillChapter: item.expectedFulfillChapter,
          }
        : normalizeLegacyForeshadowFields(item.required, item.expectedFulfillChapter)
      return [
        id,
        {
          ...item,
          ...normalized,
          required: deriveLegacyRequired(normalized.resolutionPolicy),
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

export function migrateStoryMemoryToV3(
  memory: StoryMemory | LegacyStoryMemoryV2 | LegacyStoryMemoryV1
): StoryMemory {
  if (memory.version === '3') return memory
  const v2 = memory.version === '1' ? migrateStoryMemoryV1ToV2(memory) : memory
  return { ...v2, version: '3' }
}
