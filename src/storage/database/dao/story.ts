import type { Story, StoryCreateInput, StoryStatus } from '../../../types/story.js'
import { generateId } from '../../../utils/id.js'
import { getStoryOutputDir, getOutputsDir } from '../../../utils/paths.js'
import { renameSync, existsSync, mkdirSync, readdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readMetaJsonSync, writeMetaJsonSync, type StoryMeta } from '../index.js'

export async function initStoryDb(): Promise<void> {
}

export function createStory(input: StoryCreateInput): Story {
  const now = Date.now()
  const id = generateId('story')
  const title = input.title ?? ''
  const provider = input.provider ?? 'openai'
  const outputDir = getStoryOutputDir(id, title)

  mkdirSync(outputDir, { recursive: true })

  const storyMeta: StoryMeta['story'] = {
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
  }

  if (input.worldDirection) {
    storyMeta.worldDirection = input.worldDirection
  }

  const meta: StoryMeta = {
    story: storyMeta,
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

export function listStories(): Story[] {
  const booksDir = getOutputsDir()
  if (!existsSync(booksDir)) return []

  const stories: Story[] = []
  for (const entry of readdirSync(booksDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const metaPath = join(booksDir, entry.name, 'meta.json')
    if (!existsSync(metaPath)) continue
    try {
      const content = readFileSync(metaPath, 'utf-8')
      const meta = JSON.parse(content) as StoryMeta
      if (meta.story) {
        stories.push(meta.story)
      }
    } catch {
    }
  }

  return stories.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function deleteStory(id: string): boolean {
  const story = getStory(id)
  if (!story) return false

  if (existsSync(story.outputDir)) {
    rmSync(story.outputDir, { recursive: true, force: true })
  }

  return true
}
