import type { StoryArc } from '../types/outline.js'
import type {
  ActPressureVerifiedConstraint,
  GenericVerifiedConstraint,
  VerifiedConstraint,
  VerifiedConstraintLike,
} from '../types/verified-constraint.js'
import { getActForChapter } from './story-arc.js'

export function createGenericVerifiedConstraint(text: string): GenericVerifiedConstraint {
  return { kind: 'generic', text }
}

export function createActPressureConstraint(
  actIndex: number,
  text: string,
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
  constraints: readonly VerifiedConstraintLike[] | undefined,
): VerifiedConstraint[] {
  if (!constraints || constraints.length === 0) return []

  return constraints.flatMap(constraint => {
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
  constraints: readonly VerifiedConstraintLike[] | undefined,
): string[] {
  return normalizeVerifiedConstraints(constraints).map(constraint => constraint.text)
}

export function filterVerifiedConstraintsForChapter(
  constraints: readonly VerifiedConstraintLike[] | undefined,
  storyArc: StoryArc | null | undefined,
  chapterIndex: number,
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
