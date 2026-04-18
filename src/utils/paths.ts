import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2))
  }
  return resolve(path)
}

export function getConfigDir(): string {
  return expandPath('~/.museflow')
}

export function getOutputsDir(): string {
  return join(process.cwd(), 'books')
}

export function getStoryOutputDir(storyId: string, title?: string): string {
  return join(getOutputsDir(), `${normalizeStoryTitle(title)}-${getStoryShortId(storyId)}`)
}

export function getChapterFilePath(outputDir: string, chapterNumber: number): string {
  return join(outputDir, `chapter_${chapterNumber}.md`)
}

export function getConfigFilePath(): string {
  return join(getConfigDir(), 'config.json')
}

export function getCheckpointFilePath(outputDir: string, storyId: string): string {
  return join(outputDir, `${storyId}.sqlite`)
}

function getStoryShortId(storyId: string): string {
  const suffix = storyId.split('_').pop() ?? storyId
  return suffix.slice(0, 6).toLowerCase()
}

function normalizeStoryTitle(title?: string): string {
  const normalized = title
    ?.normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return normalized || 'untitled'
}
