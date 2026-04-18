import { getOutputsDir } from '../../utils/paths.js'
import { logger } from '../../utils/logger.js'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * JSON-based per-story metadata storage.
 * Each story's data lives at books/{storyId}/meta.json
 */

export interface StoryMeta {
  story: {
    id: string
    title: string
    worldDirection?: {
      cultivationSystem: string
      coreConflict: string
      worldFeatures: string[]
    }
    idea: string
    genre: string
    totalChapters: number
    status: 'init' | 'worldbuilding' | 'outlining' | 'writing' | 'done' | 'error'
    provider: string
    outputDir: string
    createdAt: number
    updatedAt: number
  }
  world: {
    id: string
    storyId: string
    content: string
  } | null
  characters: Array<{
    id: string
    storyId: string
    name: string
    description: string | null
    dialogueStyle: string | null
    createdAt: number
  }>
  outline: Array<{
    number: number
    title: string
    description: string
  }>
  chapters: Array<{
    id: string
    storyId: string
    number: number
    title: string | null
    outline: string | null
    summary: string | null
    foreshadows: string | null
    status: 'outline' | 'drafting' | 'reviewing' | 'done' | 'error'
    createdAt: number
    updatedAt: number
  }>
  contextSnapshot: {
    id: string
    storyId: string
    stateJson: string
    createdAt: number
  } | null
}

export function ensureStoryDir(storyId: string): string {
  const dir = join(getOutputsDir(), storyId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    logger.debug(`Created story directory: ${dir}`)
  }
  return dir
}

export function getStoryMetaPath(storyId: string): string {
  return join(getOutputsDir(), storyId, 'meta.json')
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
  ensureStoryDir(storyId)
  const path = getStoryMetaPath(storyId)
  writeFileSync(path, JSON.stringify(meta, null, 2), 'utf-8')
  logger.debug(`Saved meta.json for story ${storyId}`)
}

export function readMetaJsonSync(storyId: string): StoryMeta | null {
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

export function writeMetaJsonSync(storyId: string, meta: StoryMeta): void {
  ensureStoryDir(storyId)
  const path = getStoryMetaPath(storyId)
  writeFileSync(path, JSON.stringify(meta, null, 2), 'utf-8')
  logger.debug(`Saved meta.json for story ${storyId}`)
}

// Re-export types used by other modules
export type { Story, StoryCreateInput, StoryStatus } from '../../types/story.js'
export type { ChapterMeta, ChapterStatus } from '../../types/chapter.js'
export type { Character, CharacterCreateInput } from '../../types/character.js'
export type { WorldContent, ContextSnapshot } from '../../types/context.js'
