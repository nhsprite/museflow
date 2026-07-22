import type { Issue } from '../types/agent.js'
import type { StoryArc } from '../types/outline.js'
import type { StoryMemory } from '../types/story-memory.js'
import { getMandatoryBeatEntries } from '../utils/mandatory-beat-ids.js'
import { getCoveredMandatoryBeatId, isBeatProven } from '../utils/beat-coverage.js'

export type StoryCompletionStatus = 'in_progress' | 'blocked' | 'complete'

export interface StoryCompletionInput {
  currentChapterIndex: number
  totalChapters: number
  storyArc: StoryArc | null | undefined
  storyMemory: StoryMemory | null | undefined
  pendingIssues: ReadonlyArray<Pick<Issue, 'id' | 'severity'>>
}

export interface StoryCompletionAudit {
  status: StoryCompletionStatus
  chapterLimitReached: boolean
  unprovenBeatIds: string[]
  unresolvedMustForeshadowIds: string[]
  unresolvedShouldForeshadowIds: string[]
  pendingErrorIssueIds: string[]
  structuralBlockerCodes: Array<'story_arc_missing' | 'story_memory_missing'>
}

export function evaluateStoryCompletion(input: StoryCompletionInput): StoryCompletionAudit {
  const chapterLimitReached = input.currentChapterIndex >= input.totalChapters
  const structuralBlockerCodes: StoryCompletionAudit['structuralBlockerCodes'] = []
  if (!input.storyArc) structuralBlockerCodes.push('story_arc_missing')
  if (!input.storyMemory) structuralBlockerCodes.push('story_memory_missing')

  const unprovenBeatIds = getUnprovenRequiredBeatIds(input.storyArc, input.storyMemory)
  const unresolvedMustForeshadowIds: string[] = []
  const unresolvedShouldForeshadowIds: string[] = []

  for (const foreshadow of Object.values(input.storyMemory?.foreshadows ?? {})) {
    if (foreshadow.fulfilledIn !== null || foreshadow.waivedIn !== undefined) continue
    if (foreshadow.resolutionPolicy === 'must_resolve') {
      unresolvedMustForeshadowIds.push(foreshadow.id)
    } else if (foreshadow.resolutionPolicy === 'should_resolve') {
      unresolvedShouldForeshadowIds.push(foreshadow.id)
    }
  }

  const pendingErrorIssueIds = input.pendingIssues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.id)
  const hasBlockers =
    structuralBlockerCodes.length > 0 ||
    unprovenBeatIds.length > 0 ||
    unresolvedMustForeshadowIds.length > 0 ||
    pendingErrorIssueIds.length > 0

  return {
    status: !chapterLimitReached ? 'in_progress' : hasBlockers ? 'blocked' : 'complete',
    chapterLimitReached,
    unprovenBeatIds,
    unresolvedMustForeshadowIds,
    unresolvedShouldForeshadowIds,
    pendingErrorIssueIds,
    structuralBlockerCodes,
  }
}

export function getUnprovenRequiredBeatIds(
  storyArc: StoryArc | null | undefined,
  memory: StoryMemory | null | undefined
): string[] {
  if (!storyArc) return []

  const requiredBeatIds = [
    ...getMandatoryBeatEntries(storyArc).map((entry) => entry.id),
    ...storyArc.keyBeats
      .filter((beat) => beat.required && getCoveredMandatoryBeatId(storyArc, beat.id) === undefined)
      .map((beat) => beat.id),
  ]
  return [...new Set(requiredBeatIds.filter((beatId) => !isBeatProven(storyArc, memory, beatId)))]
}

export function getUnprovenRequiredKeyBeatIdsThroughAct(
  storyArc: StoryArc,
  memory: StoryMemory,
  actIndex: number
): string[] {
  return storyArc.keyBeats
    .filter(
      (beat) =>
        beat.required &&
        beat.deadlineAct <= actIndex &&
        getCoveredMandatoryBeatId(storyArc, beat.id) === undefined
    )
    .filter((beat) => !isBeatProven(storyArc, memory, beat.id))
    .map((beat) => beat.id)
}
