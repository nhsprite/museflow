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

export function getCheckpointsDir(): string {
  return expandPath('~/.museflow/checkpoints')
}

export function getOutputsDir(): string {
  return expandPath('~/.museflow/outputs')
}

export function getStoryOutputDir(storyId: string): string {
  return join(getOutputsDir(), storyId)
}

export function getChapterFilePath(storyId: string, chapterNumber: number): string {
  return join(getStoryOutputDir(storyId), `chapter_${chapterNumber}.md`)
}

export function getConfigFilePath(): string {
  return join(getConfigDir(), 'config.json')
}

export function getCheckpointFilePath(storyId: string): string {
  return join(getCheckpointsDir(), `${storyId}.sqlite`)
}
