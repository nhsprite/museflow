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
  idea: string
  genre: string
  totalChapters: number
  status: StoryStatus
  provider: string
  outputDir: string
  createdAt: number
  updatedAt: number
}

export interface StoryCreateInput {
  idea: string
  genre: string
  totalChapters: number
  provider?: string
}
