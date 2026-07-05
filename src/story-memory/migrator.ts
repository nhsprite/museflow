import type { StoryState } from '../types/story-state.js'
import type { StoryMemory, StoryEvent } from '../types/story-memory.js'
import { createEmptyStoryMemory, applyEvents } from './projector.js'

/**
 * Migrate core runtime state from the old StoryState snapshot to StoryMemory.
 *
 * Scope: character locations/status, item locations/state, and pending tasks.
 * Not migrated (kept in StoryState or deferred): activePlots, revealedSecrets,
 * chapterHandoff, canonicalFacts, supersededFacts, overrides.
 */
export function migrateFromStoryState(
  storyState: StoryState,
  currentChapterIndex: number
): StoryMemory {
  const events: StoryEvent[] = []

  for (const [characterId, locationId] of Object.entries(storyState.characterLocations)) {
    events.push({
      id: `mig-c${currentChapterIndex}-charloc-${characterId}`,
      type: 'character-location',
      characterId,
      locationId: locationId || null,
      chapterIndex: currentChapterIndex,
      source: 'chapter',
    })
  }

  for (const [characterId, statusValue] of Object.entries(storyState.characterStatus)) {
    events.push({
      id: `mig-c${currentChapterIndex}-charstatus-${characterId}`,
      type: 'character-status',
      characterId,
      attribute: 'status',
      value: statusValue,
      chapterIndex: currentChapterIndex,
      source: 'chapter',
    })
  }

  for (const [itemId, locationId] of Object.entries(storyState.keyItemsLocation)) {
    events.push({
      id: `mig-c${currentChapterIndex}-itemloc-${itemId}`,
      type: 'item-location',
      itemId,
      holderId: null,
      locationId: locationId || null,
      chapterIndex: currentChapterIndex,
      source: 'chapter',
    })
  }

  for (const [itemId, stateValue] of Object.entries(storyState.keyItemsState)) {
    events.push({
      id: `mig-c${currentChapterIndex}-itemstate-${itemId}`,
      type: 'item-state',
      itemId,
      attribute: 'state',
      value: stateValue,
      chapterIndex: currentChapterIndex,
      source: 'chapter',
    })
  }

  for (const task of storyState.pendingTasks ?? []) {
    events.push({
      id: `mig-c${currentChapterIndex}-task-${task.id}`,
      type: 'task-create',
      taskId: task.id,
      description: task.description,
      chapterIndex: task.createdChapter,
      source: 'chapter',
    })
    if (task.status === 'done') {
      events.push({
        id: `mig-c${currentChapterIndex}-taskresolve-${task.id}`,
        type: 'task-resolve',
        taskId: task.id,
        chapterIndex: currentChapterIndex,
        source: 'chapter',
      })
    }
  }

  const base = createEmptyStoryMemory()
  return applyEvents({ ...base, lastChapterIndex: currentChapterIndex }, events)
}
