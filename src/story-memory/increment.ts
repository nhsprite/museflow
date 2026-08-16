import type { StoryEvent, StoryMemory } from '../types/story-memory.js'
import { diffMemorySnapshots } from './diff.js'

/**
 * 跨章零增量判定（Workstream C.2.2）。
 *
 * 零增量章 = 应用本章已接受事件后，StoryMemory 投影在以下维度全部无变化：
 * 角色位置/状态、物品持有人/位置/状态、伏笔埋设/兑现/延期、任务开启/关闭、
 * 以及 plot-advance 节拍推进。纯事件枚举与实体 ID 比较，不触碰任何正文语义。
 */
export interface ChapterIncrementVerdict {
  /** 判定对应的章节（防止跨章节读到陈旧校验结果）。 */
  chapterIndex: number
  zeroIncrement: boolean
  /** 本章参与判定的已接受结构化事件数。 */
  acceptedEventCount: number
  /** 各增量维度计数，供报告与日志展示。 */
  increments: {
    characterLocationChanges: number
    characterStatusChanges: number
    itemHolderChanges: number
    itemLocationChanges: number
    itemStateChanges: number
    newForeshadows: number
    fulfilledForeshadows: number
    foreshadowDeadlineExtensions: number
    newTasks: number
    resolvedTasks: number
    plotAdvances: number
    /** 显式复活事件数（B.1）：复活是真实情节推进，必须计入增量。 */
    characterRevivals: number
    /** 实体注册事件数（B.3）：新有名实体进入追踪是真实状态变化，必须计入增量。 */
    entityRegistrations: number
  }
}

export function evaluateChapterIncrement(
  chapterIndex: number,
  memoryBefore: StoryMemory,
  memoryAfter: StoryMemory,
  chapterEvents: readonly StoryEvent[]
): ChapterIncrementVerdict {
  const diff = diffMemorySnapshots(memoryBefore, memoryAfter)
  const plotAdvances = chapterEvents.filter((event) => event.type === 'plot-advance').length
  const foreshadowDeadlineExtensions = chapterEvents.filter(
    (event) => event.type === 'foreshadow-deadline-extend'
  ).length
  const characterRevivals = chapterEvents.filter(
    (event) => event.type === 'character-revival'
  ).length
  const entityRegistrations = chapterEvents.filter(
    (event) => event.type === 'entity-register'
  ).length

  const increments: ChapterIncrementVerdict['increments'] = {
    characterLocationChanges: diff.characterLocations.length,
    characterStatusChanges: diff.characterStatuses.length,
    itemHolderChanges: diff.itemHolders.length,
    itemLocationChanges: diff.itemLocations.length,
    itemStateChanges: diff.itemStates.length,
    newForeshadows: diff.newForeshadows.length,
    fulfilledForeshadows: diff.fulfilledForeshadows.length,
    foreshadowDeadlineExtensions,
    newTasks: diff.newTasks.length,
    resolvedTasks: diff.resolvedTasks.length,
    plotAdvances,
    characterRevivals,
    entityRegistrations,
  }

  return {
    chapterIndex,
    zeroIncrement: Object.values(increments).every((count) => count === 0),
    acceptedEventCount: chapterEvents.length,
    increments,
  }
}
