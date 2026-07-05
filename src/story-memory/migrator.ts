import type { StoryState } from '../types/story-state.js'
import type { StoryMemory, StoryEvent, EntityId, TaskId } from '../types/story-memory.js'
import { createEmptyStoryMemory, applyEvents } from './projector.js'

export function migrateFromStoryState(
  storyState: StoryState,
  currentChapterIndex: number
): StoryMemory {
  const events: StoryEvent[] = []

  for (const [characterId, locationId] of Object.entries(storyState.characterLocations)) {
    events.push({
      id: `mig-charloc-${characterId}`,
      type: 'character-location',
      characterId: characterId as EntityId,
      locationId: locationId || null,
      chapterIndex: currentChapterIndex,
      source: 'chapter',
    })
  }

  for (const [characterId, statusValue] of Object.entries(storyState.characterStatus)) {
    events.push({
      id: `mig-charstatus-${characterId}`,
      type: 'character-status',
      characterId: characterId as EntityId,
      attribute: 'status',
      value: statusValue,
      chapterIndex: currentChapterIndex,
      source: 'chapter',
    })
  }

  for (const [itemId, locationId] of Object.entries(storyState.keyItemsLocation)) {
    events.push({
      id: `mig-itemloc-${itemId}`,
      type: 'item-location',
      itemId: itemId as EntityId,
      holderId: null,
      locationId: locationId || null,
      chapterIndex: currentChapterIndex,
      source: 'chapter',
    })
  }

  for (const [itemId, stateValue] of Object.entries(storyState.keyItemsState)) {
    events.push({
      id: `mig-itemstate-${itemId}`,
      type: 'item-state',
      itemId: itemId as EntityId,
      attribute: 'state',
      value: stateValue,
      chapterIndex: currentChapterIndex,
      source: 'chapter',
    })
  }

  for (const task of storyState.pendingTasks ?? []) {
    events.push({
      id: `mig-task-${task.id}`,
      type: 'task-create',
      taskId: task.id as TaskId,
      description: task.description,
      chapterIndex: task.createdChapter,
      source: 'chapter',
    })
    if (task.status === 'done') {
      events.push({
        id: `mig-taskresolve-${task.id}`,
        type: 'task-resolve',
        taskId: task.id as TaskId,
        chapterIndex: currentChapterIndex,
        source: 'chapter',
      })
    }
  }

  const base = createEmptyStoryMemory()
  return applyEvents({ ...base, lastChapterIndex: currentChapterIndex }, events)
}
