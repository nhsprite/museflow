import type { StoryMemory, ForeshadowId, BeatId, TaskId, EntityId } from '../types/story-memory.js'

export function getActiveForeshadows(memory: StoryMemory): ForeshadowId[] {
  return Object.values(memory.foreshadows)
    .filter((f) => f.fulfilledIn === null && f.waivedIn === undefined)
    .map((f) => f.id)
}

export function getOverdueForeshadows(memory: StoryMemory, currentChapter: number): ForeshadowId[] {
  return Object.values(memory.foreshadows)
    .filter(
      (f) =>
        f.fulfilledIn === null &&
        f.waivedIn === undefined &&
        f.resolutionPolicy === 'must_resolve' &&
        f.expectedFulfillChapter !== null &&
        currentChapter > f.expectedFulfillChapter
    )
    .map((f) => f.id)
}

export function getUnprovenMandatoryBeats(memory: StoryMemory): BeatId[] {
  return Object.values(memory.beats)
    .filter((b) => b.required && b.provenByEventIds.length === 0)
    .map((b) => b.id)
}

export function getOpenTasks(memory: StoryMemory): TaskId[] {
  return Object.values(memory.tasks)
    .filter((t) => t.resolvedIn === null)
    .map((t) => t.id)
}

export function getCharacterLocation(memory: StoryMemory, characterId: EntityId): string | null {
  return memory.entities.characters[characterId]?.locationId ?? null
}

export function getItemHolder(memory: StoryMemory, itemId: EntityId): string | null {
  return memory.entities.items[itemId]?.holderId ?? null
}
