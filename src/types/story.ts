export interface WorldDirection {
  cultivationSystem?: string
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
  provider: string
  outputDir: string
  createdAt: number
  updatedAt: number
  outlineStrategy?: 'layered' | 'legacy'
}

export interface StoryCreateInput {
  title?: string
  worldDirection?: WorldDirection
  idea: string
  genre: string
  totalChapters: number
  provider?: string
  outlineStrategy?: 'layered' | 'legacy'
}

export interface StoryConfig {
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
  outlineStrategy?: 'layered' | 'legacy'
}
