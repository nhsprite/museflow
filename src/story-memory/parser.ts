import { generateId } from '../utils/id.js'
import type { StoryEvent } from '../types/story-memory.js'

export function parseStoryEventsBlock(text: string, chapterIndex: number): StoryEvent[] {
  const match = text.match(/=== STORY_EVENTS ===\n([\s\S]*?)\n=== CHAPTER_CONTENT ===/)
  if (!match) return []
  const block = match[1] ?? ''
  const events: StoryEvent[] = []

  for (const line of block.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parsed = parseEventLine(trimmed, chapterIndex)
    if (parsed) events.push(parsed)
  }

  return events
}

function parseEventLine(line: string, chapterIndex: number): StoryEvent | null {
  const charLoc = line.match(/^-\s*character-location:\s*(\S+)\s*->\s*(\S+)$/)
  if (charLoc) {
    return {
      id: generateId('evt'),
      type: 'character-location',
      characterId: charLoc[1]!,
      locationId: charLoc[2]!,
      chapterIndex,
      source: 'chapter',
    }
  }

  const charStatus = line.match(/^-\s*character-status:\s*(\S+)\s*\/\s*(\S+)\s*->\s*(.+)$/)
  if (charStatus) {
    return {
      id: generateId('evt'),
      type: 'character-status',
      characterId: charStatus[1]!,
      attribute: charStatus[2]!,
      value: charStatus[3]!.trim(),
      chapterIndex,
      source: 'chapter',
    }
  }

  const itemLoc = line.match(/^-\s*item-location:\s*(\S+)\s*->\s*(\S+)$/)
  if (itemLoc) {
    return {
      id: generateId('evt'),
      type: 'item-location',
      itemId: itemLoc[1]!,
      holderId: itemLoc[2]!,
      locationId: null,
      chapterIndex,
      source: 'chapter',
    }
  }

  const itemState = line.match(/^-\s*item-state:\s*(\S+)\s*\/\s*(\S+)\s*->\s*(.+)$/)
  if (itemState) {
    return {
      id: generateId('evt'),
      type: 'item-state',
      itemId: itemState[1]!,
      attribute: itemState[2]!,
      value: itemState[3]!.trim(),
      chapterIndex,
      source: 'chapter',
    }
  }

  const fsIntroduce = line.match(/^-\s*foreshadow-introduce:\s*(\S+)\s*(?:\/\s*(\S+))?$/)
  if (fsIntroduce) {
    return {
      id: generateId('evt'),
      type: 'foreshadow-introduce',
      foreshadowId: fsIntroduce[1]!,
      expectedFulfillChapter: fsIntroduce[2] ? Number(fsIntroduce[2]) : null,
      chapterIndex,
      source: 'chapter',
    }
  }

  const fsFulfill = line.match(/^-\s*foreshadow-fulfill:\s*(\S+)$/)
  if (fsFulfill) {
    return {
      id: generateId('evt'),
      type: 'foreshadow-fulfill',
      foreshadowId: fsFulfill[1]!,
      chapterIndex,
      source: 'chapter',
    }
  }

  const beatAdvance = line.match(/^-\s*plot-advance:\s*(\S+)\s*\/\s*(\S+)$/)
  if (beatAdvance) {
    return {
      id: generateId('evt'),
      type: 'plot-advance',
      plotId: beatAdvance[1]!,
      beatId: beatAdvance[2]!,
      chapterIndex,
      source: 'chapter',
    }
  }

  const taskCreate = line.match(/^-\s*task-create:\s*(\S+)\s*\/\s*(.+)$/)
  if (taskCreate) {
    return {
      id: generateId('evt'),
      type: 'task-create',
      taskId: taskCreate[1]!,
      description: taskCreate[2]!.trim(),
      chapterIndex,
      source: 'chapter',
    }
  }

  const taskResolve = line.match(/^-\s*task-resolve:\s*(\S+)$/)
  if (taskResolve) {
    return {
      id: generateId('evt'),
      type: 'task-resolve',
      taskId: taskResolve[1]!,
      chapterIndex,
      source: 'chapter',
    }
  }

  return null
}
