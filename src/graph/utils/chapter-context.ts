import type { ReducedGraphState } from '../state.js'
import type { AgentInput } from '../../agents/types.js'
import type { Character } from '../../types/character.js'
import type { ForeshadowItem } from '../../types/foreshadow.js'
import type { CanonicalFact } from '../../types/story-state.js'
import type { WritingConstraints } from '../../types/story.js'
import type { ModelProvider } from '../../model/provider.js'
import type { RuntimeContext } from '../../core/context.js'
import { getActForChapter } from '../../utils/story-arc.js'
import { buildLayeredSummaries } from '../../utils/summary-compressor.js'
import { selectChapterSummaries } from '../../utils/chapter-summaries.js'
import {
  buildCharacterFactTimeline,
  formatCanonicalFactsSections,
  formatStoryState,
  prepareStoryStateForChapter,
  prioritizeCanonicalFacts,
  type PrepareStoryStateOptions,
  type PreparedStoryState,
} from './reconciler/index.js'
import { buildEffectiveCharactersList, charactersToString } from './characters.js'
import { buildPreviousChapterEndingContext } from './chapter-window.js'
import { formatStoryTime, isEmptyStoryTime } from '../../utils/story-time.js'

type ChapterContextSource = ModelProvider | RuntimeContext

const preparedStoryStateCache = new WeakMap<RuntimeContext, Map<string, PreparedStoryState>>()

function isRuntimeContext(source: ChapterContextSource): source is RuntimeContext {
  return 'provider' in source
}

function normalizedIds(ids: readonly string[] | undefined): string[] {
  return [...(ids ?? [])].sort()
}

function buildPreparedStoryStateCacheKey(state: ReducedGraphState, chapterIndex: number): string {
  const outlineItem = state.outline[chapterIndex]
  const outlineInput = outlineItem
    ? {
        description: outlineItem.description,
        touchedCharacterIds: normalizedIds(outlineItem.touchedCharacterIds),
        touchedItemIds: normalizedIds(outlineItem.touchedItemIds),
        touchedLocationIds: normalizedIds(outlineItem.touchedLocationIds),
      }
    : null
  const storyMemoryInput = state.storyMemory
    ? {
        version: state.storyMemory.version,
        lastChapterIndex: state.storyMemory.lastChapterIndex,
        entities: state.storyMemory.entities,
        beats: state.storyMemory.beats,
      }
    : null
  const storyArcInput = state.storyArc
    ? {
        totalChapters: state.storyArc.totalChapters,
        acts: state.storyArc.acts,
        keyBeats: state.storyArc.keyBeats,
      }
    : null

  return JSON.stringify({
    storyId: state.story.id,
    chapterIndex,
    outlineInput,
    characters: state.characters,
    storyState: state.storyState,
    storyMemoryInput,
    storyArcInput,
    authorDecisions: state.authorDecisions,
  })
}

export async function prepareStoryStateForChapterCached(
  state: ReducedGraphState,
  chapterIndex: number,
  source: ChapterContextSource,
  options: PrepareStoryStateOptions = {}
): Promise<PreparedStoryState> {
  if (!isRuntimeContext(source)) {
    return prepareStoryStateForChapter(state, chapterIndex, source, options)
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

  const prepared = await prepareStoryStateForChapter(state, chapterIndex, source.provider, options)
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
  chapterContract?: string
  timelineSnapshot: string
  canonicalFacts: CanonicalFact[] | undefined
  chapterTimeAnchor?: string
  storyArc: ReducedGraphState['storyArc']
  writingConstraints?: WritingConstraints
}

/**
 * 本章契约触及的实体 id 集合（B.2 渲染优先级）：章节大纲 touched 实体 +
 * 章节规划 expectedEvents 引用的实体。纯结构化 id 收集，供权威事实优先渲染。
 */
export function collectChapterContractEntityIds(
  state: ReducedGraphState,
  chapterIndex: number
): string[] {
  const ids = new Set<string>()
  const outlineItem = state.outline[chapterIndex]
  for (const id of outlineItem?.touchedCharacterIds ?? []) ids.add(id)
  for (const id of outlineItem?.touchedItemIds ?? []) ids.add(id)
  for (const id of outlineItem?.touchedLocationIds ?? []) ids.add(id)
  for (const event of state.chapterPlan?.expectedEvents ?? []) {
    switch (event.type) {
      case 'character-location':
      case 'character-status':
      case 'character-revival':
        ids.add(event.characterId)
        break
      case 'item-location':
        ids.add(event.itemId)
        if (event.holderId !== null) ids.add(event.holderId)
        break
      case 'item-state':
        ids.add(event.itemId)
        break
    }
  }
  return [...ids]
}

function renderWritingConstraintsForContract(writingConstraints?: WritingConstraints): string[] {
  if (!writingConstraints) return []

  const lines: string[] = []
  const chapterOpening = writingConstraints.chapterOpening
  if (chapterOpening?.required && chapterOpening.instruction.trim()) {
    lines.push('【全书写作形式硬约束】')
    lines.push(`- 章节开头形式：${chapterOpening.instruction.trim()}`)
  }

  const globalRules = writingConstraints.globalRules?.filter((rule) => rule.trim()) ?? []
  if (globalRules.length > 0) {
    if (lines.length === 0) lines.push('【全书写作形式硬约束】')
    for (const rule of globalRules) {
      lines.push(`- ${rule.trim()}`)
    }
  }

  return lines
}

function buildChapterContract(
  state: ReducedGraphState,
  chapterIndex: number,
  reconciledState: NonNullable<ReducedGraphState['storyState']>
): string {
  const lines: string[] = ['【章节契约】']

  lines.push(...renderWritingConstraintsForContract(state.story.writingConstraints))

  const handoff = reconciledState.chapterHandoff ?? state.storyState?.chapterHandoff
  if (handoff) {
    const charactersPresent = handoff.charactersPresent ?? []
    const openQuestions = handoff.openQuestions ?? []
    lines.push('【上一章交接状态】')
    if (handoff.endScene) lines.push(`- 结束场景：${handoff.endScene}`)
    if (!isEmptyStoryTime(handoff.endTime)) {
      lines.push(`- 结束时间：${formatStoryTime(handoff.endTime)}`)
    }
    if (charactersPresent.length > 0) {
      lines.push(`- 在场角色：${charactersPresent.join('、')}`)
    }
    if (handoff.lastAction) lines.push(`- 最后动作：${handoff.lastAction}`)
    if (openQuestions.length > 0) {
      lines.push(`- 待承接问题：${openQuestions.join('、')}`)
    }
    if (handoff.requiredNextOpening) {
      lines.push(`- 下一章开头要求：${handoff.requiredNextOpening}`)
    }
  }

  const currentAct = getActForChapter(state.storyArc, chapterIndex)
  if (currentAct) {
    const progress = state.actProgress[currentAct.index] ?? {
      consumed: [],
      pending: [...currentAct.mandatoryBeats],
    }
    const pendingBeats = progress.pending
    if (pendingBeats.length > 0) {
      lines.push('【本章可推进的 mandatory beats】')
      for (const beat of pendingBeats) {
        lines.push(`- ${beat}`)
      }
    }

    const futureBeats = (state.storyArc?.acts ?? [])
      .filter((act) => act.index > currentAct.index)
      .flatMap((act) => act.mandatoryBeats)
      .slice(0, 12)
    if (futureBeats.length > 0) {
      lines.push('【不得提前消费的后续 mandatory beats】')
      for (const beat of futureBeats) {
        lines.push(`- ${beat}`)
      }
    }
  }

  const activeFacts = (reconciledState.canonicalFacts ?? []).filter(
    (fact) => fact.retiredIn === undefined && fact.confidence !== 'low'
  )
  // B.2：受保护事实同样走优先级渲染——终态/生命周期事实与本章契约触及实体
  // 不被新近度窗口截断，保证早期确立的死亡事实在后期章节契约中仍可见。
  const prioritizedProtectedFacts = prioritizeCanonicalFacts(
    activeFacts.filter((fact) => fact.source !== 'outline_inference'),
    collectChapterContractEntityIds(state, chapterIndex)
  )
  lines.push(
    ...formatCanonicalFactsSections([
      {
        title: '【受保护权威事实】',
        facts: prioritizedProtectedFacts,
        limit: prioritizedProtectedFacts.length,
        formatFact: (fact) => [`- [${fact.subject}] ${fact.attribute}: ${fact.value}`],
      },
      {
        title: '【大纲推断事实（提示级，正文/已确立事实优先）】',
        facts: activeFacts.filter((fact) => fact.source === 'outline_inference'),
        limit: 10,
        formatFact: (fact) => [`- [${fact.subject}] ${fact.attribute}: ${fact.value}`],
      },
    ])
  )

  if (lines.length === 1) return ''
  lines.push(
    '【执行要求】规划、正文与一致性检查必须优先满足本契约；如需改变受保护事实，必须由本章大纲明确授权并在正文中提供清晰动作或证据。'
  )
  lines.push(
    '【体例约束】本契约中的 [实体 id] 仅供结构化引用（STORY_EVENTS、状态声明），严禁抄入正文；正文一律使用角色/地点/物品的名称。'
  )
  return lines.join('\n')
}

export async function buildChapterAgentContext(
  state: ReducedGraphState,
  chapterIndex: number,
  source: ChapterContextSource
): Promise<ChapterAgentContext> {
  const worldContent = state.world?.content
  const timelineSnapshot = buildCharacterFactTimeline(state, chapterIndex)

  const [previousChapterEnding, preparedState] = await Promise.all([
    buildPreviousChapterEndingContext(state, chapterIndex),
    prepareStoryStateForChapterCached(state, chapterIndex, source),
  ])
  const previousChapters = [
    buildLayeredSummaries(selectChapterSummaries(state.chapters, chapterIndex), chapterIndex),
    previousChapterEnding,
  ]
    .filter(Boolean)
    .join('\n\n')
  const { reconciledState, stateConflicts } = preparedState
  const contractEntityIds = collectChapterContractEntityIds(state, chapterIndex)
  const storyStateStr = formatStoryState(reconciledState, state.storyMemory?.entities, {
    priorityEntityIds: contractEntityIds,
  })
  const chapterContract = buildChapterContract(state, chapterIndex, reconciledState)

  const {
    merged: effectiveCharacters,
    outline: outlineCharacters,
    established: establishedCharacters,
  } = buildEffectiveCharactersList(state, chapterIndex)

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
    ...(chapterContract ? { chapterContract } : {}),
    timelineSnapshot,
    canonicalFacts: reconciledState.canonicalFacts,
    ...(chapterTimeAnchor ? { chapterTimeAnchor } : {}),
    storyArc: state.storyArc,
    ...(state.story.writingConstraints
      ? { writingConstraints: state.story.writingConstraints }
      : {}),
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
    ...(base.chapterContract ? { chapterContract: base.chapterContract } : {}),
    timelineSnapshot: base.timelineSnapshot,
    ...(base.stateConflicts ? { stateConflicts: base.stateConflicts } : {}),
    ...(base.chapterTimeAnchor ? { chapterTimeAnchor: base.chapterTimeAnchor } : {}),
    ...(base.storyArc ? { storyArc: base.storyArc } : {}),
    ...(base.writingConstraints ? { writingConstraints: base.writingConstraints } : {}),
    ...extras,
  }
}
