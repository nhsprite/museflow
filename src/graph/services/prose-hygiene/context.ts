/**
 * 从运行时状态构造正文体例检查所需的已知标识符集合。
 */

import type { StoryMemory } from '../../../types/story-memory.js'
import type { StoryArc } from '../../../types/outline.js'
import { getMandatoryBeatEntries } from '../../../utils/mandatory-beat-ids.js'
import type { ProseHygieneContext } from './types.js'

export interface ProseHygieneContextInput {
  storyMemory?: StoryMemory | null | undefined
  storyArc?: StoryArc | null | undefined
  /** 当前章的 1-based 章节号。 */
  chapterNumber?: number | undefined
  totalChapters?: number | undefined
}

export function buildProseHygieneContext(input: ProseHygieneContextInput): ProseHygieneContext {
  const entityIds: string[] = []
  const beatIds: string[] = []

  const memory = input.storyMemory
  if (memory) {
    entityIds.push(
      ...Object.keys(memory.entities.characters),
      ...Object.keys(memory.entities.items),
      ...Object.keys(memory.entities.locations),
      ...Object.keys(memory.entities.factions),
      ...Object.keys(memory.entities.plots),
      ...Object.keys(memory.foreshadows),
      ...Object.keys(memory.tasks)
    )
    beatIds.push(...Object.keys(memory.beats))
  }

  if (input.storyArc) {
    beatIds.push(
      ...getMandatoryBeatEntries(input.storyArc).map((entry) => entry.id),
      ...input.storyArc.keyBeats.map((keyBeat) => keyBeat.id)
    )
  }

  return {
    entityIds: [...new Set(entityIds)],
    beatIds: [...new Set(beatIds)],
    ...(input.chapterNumber !== undefined ? { chapterNumber: input.chapterNumber } : {}),
    ...(input.totalChapters !== undefined ? { totalChapters: input.totalChapters } : {}),
  }
}
