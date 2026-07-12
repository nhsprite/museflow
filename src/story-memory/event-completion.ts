import { diffEvents } from './diff.js'
import { renderStoryEventLine } from './event-format.js'
import { countEvidenceParagraphs } from './validator.js'
import type { StoryEvent } from '../types/story-memory.js'

export interface EventCompletionResult {
  content: string
  events: StoryEvent[]
  completedCount: number
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
  const { missing } = diffEvents(expectedEvents, actualEvents)
  if (missing.length === 0) {
    return { content, events: actualEvents, completedCount: 0 }
  }

  const paragraphCount = Math.max(countEvidenceParagraphs(content), 1)

  const completedEvents: StoryEvent[] = missing.map((event, index) => ({
    ...event,
    chapterIndex,
    source: 'chapter',
    evidence: {
      paragraphIndex: Math.min(index + 1, paragraphCount),
    },
  }))

  const allEvents = [...actualEvents, ...completedEvents]
  const updatedContent = injectEventsIntoStoryEventsBlock(content, completedEvents)

  return {
    content: updatedContent,
    events: allEvents,
    completedCount: completedEvents.length,
  }
}
