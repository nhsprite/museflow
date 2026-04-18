import type { ContextSnapshot } from '../../../types/context.js'
import { generateId } from '../../../utils/id.js'
import { readMetaJsonSync, writeMetaJsonSync } from '../index.js'

export function saveContextSnapshot(storyId: string, stateJson: string): ContextSnapshot {
  const meta = readMetaJsonSync(storyId)
  if (!meta) throw new Error(`Story ${storyId} not found`)

  const snapshot: ContextSnapshot = {
    id: generateId('snap'),
    storyId,
    stateJson,
    createdAt: Date.now(),
  }

  meta.contextSnapshot = snapshot
  writeMetaJsonSync(storyId, meta)
  return snapshot
}

export function getContextSnapshot(storyId: string): ContextSnapshot | null {
  const meta = readMetaJsonSync(storyId)
  return meta?.contextSnapshot ?? null
}
