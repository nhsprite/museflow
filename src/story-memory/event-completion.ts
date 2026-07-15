import { diffEvents } from './diff.js'
import { renderStoryEventLine } from './event-format.js'
import { countEvidenceParagraphs } from './validator.js'
import type { StoryEvent, PlotAdvanceEvent } from '../types/story-memory.js'
import type { StoryArc } from '../types/outline.js'
import type { ChapterPlan } from '../agents/types.js'
import { findMandatoryBeatById } from '../utils/mandatory-beat-ids.js'
import { generateId } from '../utils/id.js'

export interface EventCompletionResult {
  content: string
  events: StoryEvent[]
  completedCount: number
}

type ChapterEmittableStoryEvent = Exclude<StoryEvent, { type: 'foreshadow-merge' }>

function isChapterEmittableStoryEvent(event: StoryEvent): event is ChapterEmittableStoryEvent {
  return event.type !== 'foreshadow-merge'
}

function injectEventsIntoStoryEventsBlock(content: string, events: StoryEvent[]): string {
  if (events.length === 0) return content

  const lines = events.map(
    (event) => `- ${renderStoryEventLine(event)} @p${event.evidence?.paragraphIndex ?? 1}`
  )
  const blockContent = lines.join('\n')

  const storyEventsMarker = /===\s*STORY_EVENTS\s*===/i
  const chapterContentMarker = /===\s*CHAPTER_CONTENT\s*===/i

  const hasStoryEvents = storyEventsMarker.test(content)
  const hasChapterContent = chapterContentMarker.test(content)

  if (hasStoryEvents && hasChapterContent) {
    return content.replace(
      /(===\s*STORY_EVENTS\s*===\n)([\s\S]*?)(\n===\s*CHAPTER_CONTENT\s*===)/i,
      (_match, prefix: string, existing: string, suffix: string) => {
        const trimmed = (existing as string).trim()
        const newBlock = trimmed ? `${trimmed}\n${blockContent}` : blockContent
        return `${prefix}${newBlock}${suffix}`
      }
    )
  }

  if (hasChapterContent) {
    return content.replace(
      /(===\s*CHAPTER_CONTENT\s*===)/i,
      `=== STORY_EVENTS ===\n${blockContent}\n$1`
    )
  }

  return `=== STORY_EVENTS ===\n${blockContent}\n=== CHAPTER_CONTENT ===\n${content}`
}

export function completeMissingExpectedEvents(
  content: string,
  expectedEvents: StoryEvent[],
  actualEvents: StoryEvent[],
  chapterIndex: number
): EventCompletionResult {
  const chapterActualEvents = actualEvents.filter(isChapterEmittableStoryEvent)
  const { missing } = diffEvents(expectedEvents, chapterActualEvents)
  const completableMissing = missing.filter(isChapterEmittableStoryEvent)
  if (completableMissing.length === 0) {
    return { content, events: chapterActualEvents, completedCount: 0 }
  }

  const paragraphCount = Math.max(countEvidenceParagraphs(content), 1)

  const completedEvents: StoryEvent[] = completableMissing.map((event, index) => ({
    ...event,
    chapterIndex,
    source: 'chapter',
    evidence: {
      paragraphIndex: Math.min(index + 1, paragraphCount),
    },
  }))

  const allEvents = [...chapterActualEvents, ...completedEvents]
  const updatedContent = injectEventsIntoStoryEventsBlock(content, completedEvents)

  return {
    content: updatedContent,
    events: allEvents,
    completedCount: completedEvents.length,
  }
}

/**
 * 把本章声称要推进的 mandatory beats 补成 plot-advance 结构化事件。
 *
 * 章节规划（chapterPlan.expectedEvents）可能遗漏这些事件，导致 finalization 阶段报
 * beat_unproven。本函数根据 claimedMandatoryBeatIds 自动为当前幕的每个未覆盖 beat
 * 生成一条 `plot-advance: act-<n> / <beatId>` 的期望事件，供 prompt 展示和后续
 * 自动补全使用。
 */
export function augmentExpectedEventsWithMandatoryBeats(
  chapterPlan: ChapterPlan | undefined,
  storyArc: StoryArc | undefined,
  chapterIndex: number
): StoryEvent[] {
  const expectedEvents = chapterPlan?.expectedEvents ?? []
  const claimedBeatIds = chapterPlan?.claimedMandatoryBeatIds ?? []
  if (claimedBeatIds.length === 0 || !storyArc) {
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
  for (const beatId of claimedBeatIds) {
    if (existingBeatIds.has(beatId)) continue
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
  }

  return additionalEvents.length > 0 ? [...expectedEvents, ...additionalEvents] : expectedEvents
}
