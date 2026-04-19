import type { StateSnapshot } from '../../../types/timeline.js'
import { generateId } from '../../../utils/id.js'
import { readMetaJsonSync, writeMetaJsonSync } from '../index.js'

export function appendTimelineSnapshot(
  storyId: string,
  snapshot: Omit<StateSnapshot, 'id' | 'storyId' | 'createdAt'>
): StateSnapshot {
  const meta = readMetaJsonSync(storyId)
  if (!meta) throw new Error(`Story ${storyId} not found`)

  const fullSnapshot: StateSnapshot = {
    id: generateId('ts'),
    storyId,
    createdAt: Date.now(),
    ...snapshot,
  }

  if (!meta.timeline) meta.timeline = []
  meta.timeline.push(fullSnapshot)
  writeMetaJsonSync(storyId, meta)
  return fullSnapshot
}

export function getTimeline(storyId: string): StateSnapshot[] {
  const meta = readMetaJsonSync(storyId)
  return meta?.timeline ?? []
}

export function getLatestSnapshot(storyId: string): StateSnapshot | null {
  const timeline = getTimeline(storyId)
  return timeline[timeline.length - 1] ?? null
}