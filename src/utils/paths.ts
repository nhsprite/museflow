import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2))
  }
  return resolve(path)
}

function slugify(title: string): string {
  return (
    title
      .trim()
      .replace(/\s+/g, '_')
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/_{2,}/g, '_')
  )
}

function getGlobalConfigDir(): string {
  return expandPath('~/.museflow')
}

function getProjectConfigDir(): string {
  return join(process.cwd(), '.museflow')
}

export function getOutputsDir(): string {
  return join(process.cwd(), 'books')
}

export function getStoryOutputDir(storyId: string, title?: string): string {
  return join(getOutputsDir(), `${normalizeStoryTitle(title)}-${getStoryShortId(storyId)}`)
}

export function getStoryOutputDirWithTitle(title: string, storyId: string): string {
  const slug = slugify(title)
  return join(getOutputsDir(), `${slug}_${storyId}`)
}

export function getChapterFilePath(outputDir: string, chapterNumber: number): string {
  return join(outputDir, 'chapters', `chapter_${chapterNumber}.md`)
}

export function getGlobalConfigFilePath(): string {
  return join(getGlobalConfigDir(), 'config.json')
}

export function getProjectConfigFilePath(): string {
  return join(getProjectConfigDir(), 'config.json')
}

function getStoryShortId(storyId: string): string {
  const suffix = storyId.split('_').pop() ?? storyId
  return suffix.slice(0, 12).toLowerCase()
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
