import type { ReducedGraphState } from '../state.js'
import type { AgentState } from '../../agents/base.js'
import type { Character } from '../../types/character.js'
import type { ForeshadowItem } from '../../types/foreshadow.js'
import type { CanonicalFact } from '../../types/story-state.js'
import { buildLayeredSummaries } from '../../utils/summary-compressor.js'
import {
  buildCharacterFactTimeline,
  formatStoryState,
  prepareStoryStateForChapter,
} from './reconciler.js'
import { buildEffectiveCharactersList, charactersToString } from './characters.js'

/**
 * 章节级 Agent 共享上下文。
 *
 * 将起草、规划、校验等节点中重复构建的上下文抽取为统一组装器，
 * 避免多处重复调用 reconciler/characters/summary 等工具函数。
 */
export interface ChapterAgentContext {
  idea: string
  genre: string
  totalChapters: number
  world?: string
  characters: string
  charactersList: Character[]
  outlineCharacters: Character[]
  establishedCharacters: Character[]
  previousChapters: string
  chapterIndex: number
  foreshadowStack: ForeshadowItem[]
  storyState: string
  reconciledState: NonNullable<ReducedGraphState['storyState']>
  stateConflicts?: string
  timelineSnapshot: string
  canonicalFacts: CanonicalFact[] | undefined
  chapterTimeAnchor?: string
}

export async function buildChapterAgentContext(
  state: ReducedGraphState,
  chapterIndex: number
): Promise<ChapterAgentContext> {
  const worldContent = state.world?.content
  const previousChapters = buildLayeredSummaries(state.chapterSummaries, chapterIndex)
  const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)

  const { reconciledState, stateConflicts } = await prepareStoryStateForChapter(state, chapterIndex)
  const storyStateStr = formatStoryState(reconciledState)

  const { merged: effectiveCharacters, outline: outlineCharacters, established: establishedCharacters } =
    buildEffectiveCharactersList(state, chapterIndex)

  const chapterTimeAnchor = state.chapterPlan?.chapterTimeAnchor ?? state.chapterTimeAnchor

  return {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
    charactersList: effectiveCharacters,
    outlineCharacters,
    establishedCharacters,
    previousChapters,
    chapterIndex,
    foreshadowStack: state.foreshadowStack,
    storyState: storyStateStr,
    reconciledState,
    ...(stateConflicts ? { stateConflicts } : {}),
    timelineSnapshot,
    canonicalFacts: reconciledState.canonicalFacts,
    ...(chapterTimeAnchor ? { chapterTimeAnchor } : {}),
  }
}

/**
 * 将共享上下文与可选字段合并为 AgentState。
 * 用于减少重复 spread 代码并保证字段顺序一致性。
 */
export function mergeAgentState(
  base: ChapterAgentContext,
  extras: Partial<AgentState> = {}
): AgentState {
  return {
    idea: base.idea,
    genre: base.genre,
    totalChapters: base.totalChapters,
    ...(base.world ? { world: base.world } : {}),
    characters: base.characters,
    charactersList: base.charactersList,
    outlineCharacters: base.outlineCharacters,
    establishedCharacters: base.establishedCharacters,
    previousChapters: base.previousChapters,
    chapterIndex: base.chapterIndex,
    foreshadowStack: base.foreshadowStack,
    storyState: base.storyState,
    canonicalFacts: base.canonicalFacts,
    timelineSnapshot: base.timelineSnapshot,
    ...(base.stateConflicts ? { stateConflicts: base.stateConflicts } : {}),
    ...(base.chapterTimeAnchor ? { chapterTimeAnchor: base.chapterTimeAnchor } : {}),
    ...extras,
  }
}
