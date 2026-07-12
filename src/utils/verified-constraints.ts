import type { StoryArc } from '../types/outline.js'
import type {
  ActPressureVerifiedConstraint,
  GenericVerifiedConstraint,
  VerifiedConstraint,
  VerifiedConstraintLike,
} from '../types/verified-constraint.js'
import { getActForChapter } from './story-arc.js'

export function createGenericVerifiedConstraint(
  text: string,
  id?: string
): GenericVerifiedConstraint {
  return id !== undefined ? { kind: 'generic', id, text } : { kind: 'generic', text }
}

/**
 * Regenerable constraints are rebuilt from scratch every finalize (StoryMemory-
 * derived and foreshadow-boundary constraints). Their ids carry a machine-
 * readable prefix so carried-over copies from previous chapters can be dropped
 * before the fresh ones are appended.
 */
const REGENERABLE_CONSTRAINT_ID_PREFIXES = ['memory:', 'foreshadow-boundary:']

export function isRegenerableConstraintId(id: string): boolean {
  return REGENERABLE_CONSTRAINT_ID_PREFIXES.some((prefix) => id.startsWith(prefix))
}

/**
 * Deduplicate constraints, keeping the last occurrence. Generic constraints are
 * keyed by structured id when present, otherwise by exact text equality (whole-
 * string identity of machine-produced records, not prose similarity). Other
 * kinds pass through untouched.
 */
export function dedupeVerifiedConstraints(
  constraints: readonly VerifiedConstraint[]
): VerifiedConstraint[] {
  const result: VerifiedConstraint[] = []
  const genericIndexByKey = new Map<string, number>()
  for (const constraint of constraints) {
    if (constraint.kind !== 'generic') {
      result.push(constraint)
      continue
    }
    const key = constraint.id ?? `text:${constraint.text}`
    const existingIndex = genericIndexByKey.get(key)
    if (existingIndex !== undefined) {
      result[existingIndex] = constraint
    } else {
      genericIndexByKey.set(key, result.length)
      result.push(constraint)
    }
  }
  return result
}

export function createActPressureConstraint(
  actIndex: number,
  text: string
): ActPressureVerifiedConstraint {
  return { kind: 'act_pressure', actIndex, text }
}

function isVerifiedConstraint(value: unknown): value is VerifiedConstraint {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<VerifiedConstraint>
  if (candidate.kind === 'generic') {
    return typeof candidate.text === 'string'
  }
  if (candidate.kind === 'act_pressure') {
    return typeof candidate.text === 'string' && typeof candidate.actIndex === 'number'
  }
  return false
}

export function normalizeVerifiedConstraints(
  constraints: readonly VerifiedConstraintLike[] | undefined
): VerifiedConstraint[] {
  if (!constraints || constraints.length === 0) return []

  return constraints.flatMap((constraint) => {
    if (typeof constraint === 'string') {
      return constraint.trim().length > 0 ? [createGenericVerifiedConstraint(constraint)] : []
    }
    if (isVerifiedConstraint(constraint) && constraint.text.trim().length > 0) {
      return [constraint]
    }
    return []
  })
}

export function renderVerifiedConstraints(
  constraints: readonly VerifiedConstraintLike[] | undefined
): string[] {
  return normalizeVerifiedConstraints(constraints).map((constraint) => constraint.text)
}

export function filterVerifiedConstraintsForChapter(
  constraints: readonly VerifiedConstraintLike[] | undefined,
  storyArc: StoryArc | null | undefined,
  chapterIndex: number
): VerifiedConstraint[] {
  const normalized = normalizeVerifiedConstraints(constraints)
  if (normalized.length === 0) return []

  const currentAct = getActForChapter(storyArc, chapterIndex)
  if (!currentAct) return normalized

  let lastCurrentActPressure = -1

  normalized.forEach((constraint, index) => {
    if (constraint.kind === 'act_pressure' && constraint.actIndex === currentAct.index) {
      lastCurrentActPressure = index
    }
  })

  return normalized.filter((constraint, index) => {
    if (constraint.kind !== 'act_pressure') return true
    if (constraint.actIndex !== currentAct.index) return false
    return index === lastCurrentActPressure
  })
}
