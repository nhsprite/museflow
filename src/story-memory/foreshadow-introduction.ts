import type { StoryEvent } from '../types/story-memory.js'

type ForeshadowIntroduceEvent = Extract<StoryEvent, { type: 'foreshadow-introduce' }>

export function isValidForeshadowDeadline(
  introducedChapterIndex: number,
  expectedFulfillChapter: number | null
): boolean {
  return (
    expectedFulfillChapter === null ||
    (Number.isInteger(expectedFulfillChapter) &&
      expectedFulfillChapter > introducedChapterIndex + 1)
  )
}

export function isProjectableForeshadowIntroduction(event: ForeshadowIntroduceEvent): boolean {
  return isValidForeshadowDeadline(event.chapterIndex, event.expectedFulfillChapter)
}
