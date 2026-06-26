import type { ChapterMeta, ChapterStatus } from '../../../types/chapter.js'
import { generateId } from '../../../utils/id.js'
import { readMetaJsonSync, writeMetaJsonSync } from '../index.js'

export function initChapter(storyId: string, number: number, title: string): ChapterMeta {
  const meta = readMetaJsonSync(storyId)
  if (!meta) throw new Error(`Story ${storyId} not found`)

  const now = Date.now()
  const chapterMeta: ChapterMeta = {
    id: generateId('ch'),
    storyId,
    number,
    title,
    outline: null,
    summary: null,
    foreshadows: null,
    status: 'outline',
    createdAt: now,
    updatedAt: now,
  }

  const existing = meta.chapters.find(c => c.number === number)
  if (existing) {
    existing.id = chapterMeta.id
    existing.title = chapterMeta.title
    existing.updatedAt = now
  } else {
    meta.chapters.push(chapterMeta)
  }
  meta.chapters.sort((a, b) => a.number - b.number)
  writeMetaJsonSync(storyId, meta)
  return chapterMeta
}

export function updateChapterOutline(storyId: string, number: number, outline: string): void {
  const meta = readMetaJsonSync(storyId)
  if (!meta) return
  const ch = meta.chapters.find(c => c.number === number)
  if (!ch) return
  ch.outline = outline
  ch.updatedAt = Date.now()
  writeMetaJsonSync(storyId, meta)
}

export function updateChapterContent(
  storyId: string,
  number: number,
  summary: string,
  foreshadows: string,
  status: ChapterStatus,
): void {
  const meta = readMetaJsonSync(storyId)
  if (!meta) return
  const ch = meta.chapters.find(c => c.number === number)
  if (!ch) return
  ch.summary = summary
  ch.foreshadows = foreshadows
  ch.status = status
  ch.updatedAt = Date.now()
  writeMetaJsonSync(storyId, meta)
}

export function getChapter(storyId: string, number: number): ChapterMeta | null {
  const meta = readMetaJsonSync(storyId)
  if (!meta) return null
  return meta.chapters.find(c => c.number === number) ?? null
}

export function getChapters(storyId: string): ChapterMeta[] {
  const meta = readMetaJsonSync(storyId)
  if (!meta) return []
  return meta.chapters.map(ch => ({
    id: ch.id,
    storyId: ch.storyId,
    number: ch.number,
    title: ch.title,
    outline: ch.outline,
    summary: ch.summary,
    foreshadows: ch.foreshadows,
    status: ch.status as ChapterStatus,
    createdAt: ch.createdAt,
    updatedAt: ch.updatedAt,
  }))
}

export function saveOutline(storyId: string, chapters: { number: number; title: string; description: string; introducedCharacters?: string[] }[]): void {
  const meta = readMetaJsonSync(storyId)
  if (!meta) return
  meta.outline = chapters
  writeMetaJsonSync(storyId, meta)
}

export function getOutline(storyId: string): { number: number; title: string; description: string; introducedCharacters?: string[] }[] {
  const meta = readMetaJsonSync(storyId)
  if (!meta) return []
  return meta.outline
}
