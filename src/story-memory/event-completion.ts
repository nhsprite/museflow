import type { StoryEvent, PlotAdvanceEvent, StoryMemory } from '../types/story-memory.js'
import type { StoryArc } from '../types/outline.js'
import type { ChapterPlan } from '../agents/types.js'
import { findMandatoryBeatById } from '../utils/mandatory-beat-ids.js'
import { generateId } from '../utils/id.js'
import { GLOBAL_KEY_BEAT_PLOT_ID } from './protocol-ids.js'

export interface EmittedEventAcceptanceResult {
  content: string
  events: StoryEvent[]
}

type ChapterEmittableStoryEvent = Exclude<StoryEvent, { type: 'foreshadow-merge' }>

function isChapterEmittableStoryEvent(event: StoryEvent): event is ChapterEmittableStoryEvent {
  return event.type !== 'foreshadow-merge'
}

export function acceptEmittedChapterEvents(
  content: string,
  actualEvents: StoryEvent[]
): EmittedEventAcceptanceResult {
  const chapterActualEvents = actualEvents.filter(isChapterEmittableStoryEvent)
  return {
    content,
    events: chapterActualEvents,
  }
}

/**
 * 把本章声称要推进的 beats 补成 plot-advance 结构化事件。
 *
 * 章节规划（chapterPlan.expectedEvents）可能遗漏这些事件，导致 finalization 阶段报
 * beat_unproven。本函数根据 claimedMandatoryBeatIds 和 claimedBeatIds 自动为当前幕
 * 的每个未覆盖 beat 生成一条 plot-advance 期望事件，仅供 prompt 展示和缺失事件校验使用。
 * 期望事件绝不能直接提升为正文事实。
 */
export function augmentExpectedEventsWithClaimedBeats(
  chapterPlan: ChapterPlan | undefined,
  storyArc: StoryArc | undefined,
  chapterIndex: number,
  memory?: StoryMemory | null
): StoryEvent[] {
  const expectedEvents = chapterPlan?.expectedEvents ?? []
  const claimedMandatoryBeatIds = chapterPlan?.claimedMandatoryBeatIds ?? []
  const claimedKeyBeatIds = chapterPlan?.claimedBeatIds ?? []
  if ((claimedMandatoryBeatIds.length === 0 && claimedKeyBeatIds.length === 0) || !storyArc) {
    return expectedEvents
  }

  const currentAct = storyArc.acts.find(
    (act) => chapterIndex + 1 >= act.startChapter && chapterIndex + 1 <= act.endChapter
  )
  if (!currentAct) {
    return expectedEvents
  }

  const existingBeatIds = new Set(
    expectedEvents
      .filter((e): e is PlotAdvanceEvent => e.type === 'plot-advance')
      .map((e) => e.beatId)
  )

  const additionalEvents: PlotAdvanceEvent[] = []
  for (const beatId of claimedMandatoryBeatIds) {
    if (existingBeatIds.has(beatId)) continue
    if ((memory?.beats[beatId]?.provenByEventIds.length ?? 0) > 0) continue
    const lookup = findMandatoryBeatById(storyArc, beatId)
    if (!lookup || lookup.act.index !== currentAct.index) continue
    additionalEvents.push({
      id: generateId('evt'),
      type: 'plot-advance',
      chapterIndex,
      source: 'outline',
      plotId: `act-${currentAct.index}`,
      beatId,
    })
    existingBeatIds.add(beatId)
  }

  for (const beatId of claimedKeyBeatIds) {
    if (existingBeatIds.has(beatId)) continue
    if ((memory?.beats[beatId]?.provenByEventIds.length ?? 0) > 0) continue
    const keyBeat = storyArc.keyBeats.find(
      (candidate) => candidate.id === beatId && candidate.deadlineAct === currentAct.index
    )
    if (!keyBeat) continue
    additionalEvents.push({
      id: generateId('evt'),
      type: 'plot-advance',
      chapterIndex,
      source: 'outline',
      plotId: GLOBAL_KEY_BEAT_PLOT_ID,
      beatId,
    })
    existingBeatIds.add(beatId)
  }

  return additionalEvents.length > 0 ? [...expectedEvents, ...additionalEvents] : expectedEvents
}
