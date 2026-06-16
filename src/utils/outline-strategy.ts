import type { Story } from '../types/story.js'
import type { ChapterOutline } from '../graph/state.js'

const DETAILED_OUTLINE_THRESHOLD = 60

export function resolveOutlineStrategy(
  story: Story,
  outline: ChapterOutline[]
): 'layered' | 'legacy' {
  if (story.outlineStrategy) {
    return story.outlineStrategy
  }

  if (outline.length > 0) {
    const avgLength = outline.reduce((sum, item) => sum + item.description.length, 0) / outline.length
    if (avgLength > DETAILED_OUTLINE_THRESHOLD) {
      return 'legacy'
    }
  }

  return 'legacy'
}
