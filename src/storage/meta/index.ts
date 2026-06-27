import type { StateSnapshot } from '../../types/timeline.js'
import type { ForeshadowAlert, ForeshadowItem } from '../../types/foreshadow.js'
import type { StoryState } from '../../types/story-state.js'
import type { Story } from '../../types/story.js'
import type { Character } from '../../types/character.js'
import type { ChapterMeta } from '../../types/chapter.js'
import type { WorldContent } from '../../types/world.js'
import type { ChapterOutline } from '../../types/outline.js'
import { getOutputsDir } from '../../utils/paths.js'
import { logger } from '../../utils/logger.js'
import { writeFileAtomic, ensureDir } from '../../utils/fs.js'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * JSON-based per-story metadata storage.
 * Each story's data lives at books/{storyId}/meta.json
 */

export interface StoryMeta {
  story: Story
  world: WorldContent | null
  characters: Character[]
  outline: ChapterOutline[]
  chapters: ChapterMeta[]
  timeline?: StateSnapshot[]
  foreshadowStack?: ForeshadowItem[]
  foreshadowAlerts?: ForeshadowAlert[]
  storyState?: StoryState
}

export function ensureStoryDir(storyId: string): string {
  const dir = join(getOutputsDir(), storyId)
  ensureDir(dir)
  return dir
}

export function getStoryMetaPath(storyId: string): string {
  return join(getOutputsDir(), storyId, 'meta.json')
}

export function getStoryMetaPathFromOutputDir(outputDir: string): string {
  return join(outputDir, 'meta.json')
}

export async function readMetaJson(storyId: string): Promise<StoryMeta | null> {
  const path = getStoryMetaPath(storyId)
  if (!existsSync(path)) return null
  try {
    const content = readFileSync(path, 'utf-8')
    return JSON.parse(content) as StoryMeta
  } catch (err) {
    logger.error(`Failed to read meta.json for story ${storyId}: ${err}`)
    return null
  }
}

export async function writeMetaJson(storyId: string, meta: StoryMeta): Promise<void> {
  const outputDir = meta.story.outputDir
  ensureDir(outputDir)
  const path = getStoryMetaPathFromOutputDir(outputDir)
  writeFileAtomic(path, JSON.stringify(meta, null, 2))
  logger.debug(`Saved meta.json for story ${storyId} at ${path}`)
}

export function readMetaJsonSync(storyId: string): StoryMeta | null {
  const path = getStoryMetaPath(storyId)
  if (existsSync(path)) {
    try {
      const content = readFileSync(path, 'utf-8')
      return JSON.parse(content) as StoryMeta
    } catch (err) {
      logger.error(`Failed to read meta.json for story ${storyId}: ${err}`)
      return null
    }
  }

  const booksDir = getOutputsDir()
  if (!existsSync(booksDir)) return null

  const storyIdSuffix = storyId.split('_').pop() ?? storyId
  const shortId = storyIdSuffix.slice(0, 12).toLowerCase()

  try {
    const entries = readdirSync(booksDir)
    for (const entry of entries) {
      if (entry.includes(`-${shortId}`) || entry.includes(`_${shortId}`)) {
        const metaPath = join(booksDir, entry, 'meta.json')
        if (existsSync(metaPath)) {
          const content = readFileSync(metaPath, 'utf-8')
          const meta = JSON.parse(content) as StoryMeta
          if (meta.story.id === storyId) {
            return meta
          }
        }
      }
    }
  } catch {
    // ignore meta lookup errors
  }

  return null
}

export function readMetaJsonSyncFromOutputDir(outputDir: string): StoryMeta | null {
  const path = getStoryMetaPathFromOutputDir(outputDir)
  if (!existsSync(path)) return null
  try {
    const content = readFileSync(path, 'utf-8')
    return JSON.parse(content) as StoryMeta
  } catch (err) {
    logger.error(`Failed to read meta.json at ${outputDir}: ${err}`)
    return null
  }
}

export function writeMetaJsonSync(storyId: string, meta: StoryMeta): void {
  const outputDir = meta.story.outputDir
  ensureDir(outputDir)
  const path = getStoryMetaPathFromOutputDir(outputDir)
  writeFileAtomic(path, JSON.stringify(meta, null, 2))
  logger.debug(`Saved meta.json for story ${storyId} at ${path}`)
}

// Re-export types used by other modules
export type { Story, StoryCreateInput, StoryStatus } from '../../types/story.js'
export type { ChapterMeta, ChapterStatus } from '../../types/chapter.js'
export type { Character, CharacterCreateInput } from '../../types/character.js'
export type { WorldContent } from '../../types/world.js'
export type { StateSnapshot } from '../../types/timeline.js'
