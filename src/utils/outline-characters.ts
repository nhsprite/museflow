import type { Character } from '../types/character.js'

export interface OutlineCharacter {
  name: string
  sourceChapter: number
  sourceTitle: string
  sourceDescription: string
}

interface ChapterOutlineLike {
  number: number
  title: string
  description: string
  introducedCharacters?: string[]
}

export function extractOutlineCharacters(
  outlines: ChapterOutlineLike[],
  upToChapterIndex: number
): OutlineCharacter[] {
  const seen = new Map<string, OutlineCharacter>()

  for (const outline of outlines) {
    if (outline.number < 1 || outline.number > upToChapterIndex + 1) continue
    if (!outline.introducedCharacters || outline.introducedCharacters.length === 0) continue

    for (const name of outline.introducedCharacters) {
      const trimmed = name.trim()
      if (trimmed.length === 0) continue
      if (!seen.has(trimmed)) {
        seen.set(trimmed, {
          name: trimmed,
          sourceChapter: outline.number,
          sourceTitle: outline.title,
          sourceDescription: outline.description,
        })
      }
    }
  }

  return Array.from(seen.values()).sort(
    (a, b) => a.sourceChapter - b.sourceChapter || a.name.localeCompare(b.name)
  )
}

export function mergeCharacterLists(
  officialCharacters: Character[],
  outlineCharacters: OutlineCharacter[]
): Character[] {
  const officialNames = new Set(officialCharacters.map((c) => c.name.trim()))
  const merged: Character[] = [...officialCharacters]

  for (const oc of outlineCharacters) {
    const name = oc.name.trim()
    if (officialNames.has(name)) continue
    officialNames.add(name)
    merged.push({
      id: `outline_${oc.sourceChapter}_${name}`,
      storyId: '',
      name,
      aliases: [],
      isProtagonist: false,
      description: `大纲第${oc.sourceChapter}章「${oc.sourceTitle}」引入：${oc.sourceDescription.substring(0, 80)}`,
      dialogueStyle: null,
      createdAt: 0,
    })
  }

  return merged
}
