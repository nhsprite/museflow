import type { WorldContent } from '../../../types/context.js'
import { generateId } from '../../../utils/id.js'
import { readMetaJsonSync, writeMetaJsonSync } from '../index.js'

export function saveWorld(storyId: string, content: string): WorldContent {
  const meta = readMetaJsonSync(storyId)
  if (!meta) throw new Error(`Story ${storyId} not found`)

  const world: WorldContent = {
    id: generateId('world'),
    storyId,
    content,
  }

  meta.world = world
  writeMetaJsonSync(storyId, meta)
  return world
}

export function getWorld(storyId: string): WorldContent | null {
  const meta = readMetaJsonSync(storyId)
  return meta?.world ?? null
}
