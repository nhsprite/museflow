export const CHAPTER_STATUSES = [
  'outline',
  'drafting',
  'reviewing',
  'done',
  'error',
] as const
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number]

export interface Foreshadow {
  id: string
  text: string
  expectedFulfillChapter: number
  createdAt: number
}

export interface WrittenChapter {
  number: number
  title: string
  outline: string
  content: string
  summary: string
  foreshadows: Foreshadow[]
  status: ChapterStatus
  createdAt: number
  updatedAt: number
}

export interface ChapterMeta {
  id: string
  storyId: string
  number: number
  title: string | null
  outline: string | null
  summary: string | null
  foreshadows: string | null
  status: ChapterStatus
  createdAt: number
  updatedAt: number
}
