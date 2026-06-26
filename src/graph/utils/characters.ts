import type { ReducedGraphState } from '../state.js'
import type { Character } from '../../types/character.js'
import { extractOutlineCharacters, mergeCharacterLists } from '../../utils/outline-characters.js'
import { extractEstablishedCharacters } from '../../utils/established-characters.js'

export function charactersToString(characters: Character[]): string {
  return characters.map(c => {
    const parts = [`【${c.name}】`]
    if (c.description) parts.push(c.description)
    if (c.dialogueStyle) parts.push(`对话风格：${c.dialogueStyle}`)
    return parts.join('\n')
  }).join('\n')
}

export function buildEffectiveCharactersList(state: ReducedGraphState, chapterIndex: number): {
  official: Character[]
  outline: Character[]
  established: Character[]
  merged: Character[]
} {
  const official = state.characters
  const outline = extractOutlineCharacters(state.outline, chapterIndex)
  const outlineMerged = mergeCharacterLists(official, outline)
  const established = extractEstablishedCharacters(
    state.chapterSummaries ?? [],
    state.storyState,
  ).filter(ec => !outlineMerged.some(c => c.name === ec.name))
  const merged = [...outlineMerged, ...established]
  return { official, outline: outlineMerged.slice(official.length), established, merged }
}
