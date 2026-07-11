import type { ModelConfig } from './config.js'

export interface WorldDirection {
  powerSystem?: string
  /** 是否有独立的力量/规则体系。用于避免用自然语言前缀判断「无体系」。 */
  hasPowerSystem?: boolean
  coreConflict: string
  worldFeatures: string[]
}

export interface WritingConstraints {
  chapterOpening?: {
    type: 'letter' | 'diary' | 'document' | 'custom'
    required: boolean
    instruction: string
  }
  globalRules?: string[]
}

export const STORY_STATUSES = [
  'init',
  'worldbuilding',
  'outlining',
  'writing',
  'freeze',
  'done',
  'error',
] as const
export type StoryStatus = (typeof STORY_STATUSES)[number]

export interface Story {
  id: string
  title: string
  worldDirection?: WorldDirection
  idea: string
  synopsis?: string
  writingConstraints?: WritingConstraints
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
  synopsis?: string
  writingConstraints?: WritingConstraints
  genre: string
  totalChapters: number
  provider?: ModelConfig['provider']
}
