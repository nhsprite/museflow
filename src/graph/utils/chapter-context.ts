import type { ReducedGraphState } from '../state.js'
import type { AgentInput } from '../../agents/types.js'
import type { Character } from '../../types/character.js'
import type { ForeshadowItem } from '../../types/foreshadow.js'
import type { CanonicalFact } from '../../types/story-state.js'
import type { ModelProvider } from '../../model/provider.js'
import type { RuntimeContext } from '../../core/context.js'
import { buildLayeredSummaries } from '../../utils/summary-compressor.js'
import {
  buildCharacterFactTimeline,
  formatStoryState,
  prepareStoryStateForChapter,
  type PreparedStoryState,
} from './reconciler/index.js'
import { buildEffectiveCharactersList, charactersToString } from './characters.js'
import { buildPreviousChapterEndingContext } from './chapter-window.js'

type ChapterContextSource = ModelProvider | RuntimeContext

const preparedStoryStateCache = new WeakMap<RuntimeContext, Map<string, PreparedStoryState>>()

function isRuntimeContext(source: ChapterContextSource): source is RuntimeContext {
  return 'provider' in source
}

function buildPreparedStoryStateCacheKey(
  state: ReducedGraphState,
  chapterIndex: number
): string {
  const outlineItem = state.outline[chapterIndex]
  return JSON.stringify({
    storyId: state.story.id,
    chapterIndex,
    outlineItem,
    characters: state.characters,
    storyState: state.storyState,
    authorDecisions: state.authorDecisions,
  })
}

export async function prepareStoryStateForChapterCached(
  state: ReducedGraphState,
  chapterIndex: number,
  source: ChapterContextSource,
): Promise<PreparedStoryState> {
  if (!isRuntimeContext(source)) {
    return prepareStoryStateForChapter(state, chapterIndex, source)
  }

  const key = buildPreparedStoryStateCacheKey(state, chapterIndex)
  let cache = preparedStoryStateCache.get(source)
  if (!cache) {
    cache = new Map<string, PreparedStoryState>()
    preparedStoryStateCache.set(source, cache)
  }

  const cached = cache.get(key)
  if (cached) {
    return cached
  }

  const prepared = await prepareStoryStateForChapter(state, chapterIndex, source.provider)
  cache.set(key, prepared)
  return prepared
}

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
  chapterIndex: number,
  source: ChapterContextSource,
): Promise<ChapterAgentContext> {
  const worldContent = state.world?.content
  const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)

  const [previousChapterEnding, preparedState] = await Promise.all([
    buildPreviousChapterEndingContext(state, chapterIndex),
    prepareStoryStateForChapterCached(state, chapterIndex, source),
  ])
  const previousChapters = [
    buildLayeredSummaries(state.chapterSummaries, chapterIndex),
    previousChapterEnding,
  ].filter(Boolean).join('\n\n')
  const { reconciledState, stateConflicts } = preparedState
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
 * 将共享上下文与可选字段合并为 AgentInput。
 * 用于减少重复 spread 代码并保证字段顺序一致性。
 */
export function mergeAgentState(
  base: ChapterAgentContext,
  extras: Partial<AgentInput> = {}
): AgentInput {
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
    ...(base.canonicalFacts ? { canonicalFacts: base.canonicalFacts } : {}),
    timelineSnapshot: base.timelineSnapshot,
    ...(base.stateConflicts ? { stateConflicts: base.stateConflicts } : {}),
    ...(base.chapterTimeAnchor ? { chapterTimeAnchor: base.chapterTimeAnchor } : {}),
    ...extras,
  }
}
