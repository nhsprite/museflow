import { getCanonicalForeshadows } from '../story-memory/foreshadow-alias.js'
import { getOpenTasks, getUnprovenMandatoryBeats } from '../story-memory/queries.js'
import type { ForeshadowItem } from '../types/foreshadow.js'
import type { StoryArc } from '../types/outline.js'
import type { StoryMemory } from '../types/story-memory.js'
import type { VerifiedConstraint, VerifiedConstraintLike } from '../types/verified-constraint.js'
import { generateForeshadowConstraints } from './foreshadow-constraints.js'
import {
  createGenericVerifiedConstraint,
  dedupeVerifiedConstraints,
  isRegenerableConstraintId,
  normalizeVerifiedConstraints,
} from './verified-constraints.js'

export function rebuildStoryMemoryVerifiedConstraints(input: {
  existingConstraints: readonly VerifiedConstraintLike[] | undefined
  memory: StoryMemory
  foreshadowStack: readonly ForeshadowItem[]
  foreshadowStackSource: 'canonical_memory' | 'legacy_compatibility'
  currentChapter: number
  storyArc?: StoryArc | null
}): VerifiedConstraint[] {
  const carriedConstraints = normalizeVerifiedConstraints(input.existingConstraints).filter(
    (constraint) =>
      !(
        constraint.kind === 'generic' &&
        constraint.id !== undefined &&
        isRegenerableConstraintId(constraint.id)
      )
  )
  const canonicalForeshadows = getCanonicalForeshadows(input.memory)
  const activeCanonicalForeshadows = canonicalForeshadows.filter(
    (foreshadow) => foreshadow.fulfilledIn === null && foreshadow.waivedIn === undefined
  )
  const canonicalIds = new Set(canonicalForeshadows.map((foreshadow) => foreshadow.id))
  const boundaryStack =
    input.foreshadowStackSource === 'legacy_compatibility'
      ? input.foreshadowStack
      : input.foreshadowStack.filter((item) => canonicalIds.has(item.id))
  const memoryConstraints: VerifiedConstraint[] = []

  for (const foreshadow of activeCanonicalForeshadows) {
    memoryConstraints.push(
      createGenericVerifiedConstraint(
        `未回收伏笔 [${foreshadow.id}]: ${foreshadow.text}`,
        `memory:foreshadow:${foreshadow.id}`
      )
    )
  }
  for (const id of getOpenTasks(input.memory)) {
    const task = input.memory.tasks[id]
    if (task) {
      memoryConstraints.push(
        createGenericVerifiedConstraint(
          `未完成任务 [${id}]: ${task.description}`,
          `memory:task:${id}`
        )
      )
    }
  }
  for (const id of getUnprovenMandatoryBeats(input.memory, input.storyArc)) {
    const beat = input.memory.beats[id]
    if (beat) {
      memoryConstraints.push(
        createGenericVerifiedConstraint(
          `未推进节拍 [${id}]: ${beat.description}`,
          `memory:beat:${id}`
        )
      )
    }
  }

  const boundaryConstraints = generateForeshadowConstraints(
    [...boundaryStack],
    input.currentChapter
  ).map((record) => createGenericVerifiedConstraint(record.text, record.id))

  return dedupeVerifiedConstraints([
    ...carriedConstraints,
    ...memoryConstraints,
    ...boundaryConstraints,
  ])
}
