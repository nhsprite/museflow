import type { Story, StoryCreateInput, StoryStatus } from '../../../types/story.js'
import { generateId } from '../../../utils/id.js'
import { getStoryOutputDir, getStoryOutputDirWithTitle } from '../../../utils/paths.js'
import { renameSync, existsSync } from 'node:fs'
import { ensureStoryDir, readMetaJsonSync, writeMetaJsonSync, type StoryMeta } from '../index.js'

export async function initStoryDb(): Promise<void> {
}

export function createStory(input: StoryCreateInput): Story {
  const now = Date.now()
  const id = generateId('story')
  const title = input.title ?? ''
  const provider = input.provider ?? 'openai'
  const outputDir = getStoryOutputDir(id, title)

  ensureStoryDir(id)

  const meta: StoryMeta = {
    story: {
      id,
      title,
      idea: input.idea,
      genre: input.genre,
      totalChapters: input.totalChapters,
      status: 'init',
      provider,
      outputDir,
      createdAt: now,
      updatedAt: now,
    },
    world: null,
    characters: [],
    outline: [],
    chapters: [],
    contextSnapshot: null,
  }

  writeMetaJsonSync(id, meta)

  return meta.story
}

export function getStory(id: string): Story | null {
  const meta = readMetaJsonSync(id)
  return meta?.story ?? null
}

export function updateStoryStatus(id: string, status: StoryStatus): void {
  const meta = readMetaJsonSync(id)
  if (!meta) return
  meta.story.status = status
  meta.story.updatedAt = Date.now()
  writeMetaJsonSync(id, meta)
}

export function updateStoryTitle(id: string, title: string): void {
  const meta = readMetaJsonSync(id)
  if (!meta) return
  meta.story.title = title
  meta.story.updatedAt = Date.now()
  writeMetaJsonSync(id, meta)
}

export function renameStoryOutputDir(id: string, newOutputDir: string): void {
  const meta = readMetaJsonSync(id)
  if (!meta) return
  const oldOutputDir = meta.story.outputDir

  if (existsSync(oldOutputDir)) {
    renameSync(oldOutputDir, newOutputDir)
  }

  meta.story.outputDir = newOutputDir
  meta.story.updatedAt = Date.now()
  writeMetaJsonSync(id, meta)
}
