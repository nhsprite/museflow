import type { ModelConfig } from './config.js'

export interface WorldDirection {
  powerSystem?: string
  coreConflict: string
  worldFeatures: string[]
}

export const STORY_STATUSES = [
  'init',
  'worldbuilding',
  'outlining',
  'writing',
  'done',
  'error',
] as const
export type StoryStatus = (typeof STORY_STATUSES)[number]

export interface Story {
  id: string
  title: string
  worldDirection?: WorldDirection
  idea: string
  genre: string
  totalChapters: number
  status: StoryStatus
  provider: ModelConfig['provider']
  outputDir: string
  createdAt: number
  updatedAt: number
}

export interface StoryCreateInput {
  title?: string
  worldDirection?: WorldDirection
  idea: string
  genre: string
  totalChapters: number
  provider?: ModelConfig['provider']
}
