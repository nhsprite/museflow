import { logger } from '../../../utils/logger.js'
import type { ReducedGraphState } from '../../state.js'
import type { ChapterHandoff } from '../../../types/story-state.js'
import type { StoryEvent } from '../../../types/story-memory.js'
import type { Issue } from '../../../types/agent.js'
import type { ActArc } from '../../../types/outline.js'
import {
  formatActBoundaryAdjustmentCommand,
  type ActBoundaryProposal,
} from '../../../utils/story-arc.js'
import {
  findMandatoryBeatById,
  getMandatoryBeatEntries,
  getMandatoryBeatTextById,
} from '../../../utils/mandatory-beat-ids.js'
import { validatePlannedStoryEventAuthority } from '../../../story-memory/event-authority.js'
import { countEvidenceParagraphs } from '../../../story-memory/validator.js'

export function ensureOutlineLength(
  outline: ReducedGraphState['outline'],
  totalChapters: number
): ReducedGraphState['outline'] {
  const next = outline.slice(0, totalChapters)
  for (let i = next.length; i < totalChapters; i++) {
    next.push({ number: i + 1, title: '', description: '' })
  }
  return next
}

export function ensureChaptersLength(
  chapters: ReducedGraphState['chapters'],
  totalChapters: number
): ReducedGraphState['chapters'] {
  const next = chapters.slice(0, totalChapters)
  while (next.length < totalChapters) {
    next.push(null)
  }
  return next
}

export function deriveVerifiedBeatsFromPlotAdvanceEvents(
  events: StoryEvent[],
  storyArc: ReducedGraphState['storyArc']
): string[] {
  const beatIdToText = new Map(storyArc?.keyBeats.map((kb) => [kb.id, kb.beat]) ?? [])
  return events
    .filter((e): e is StoryEvent & { type: 'plot-advance' } => e.type === 'plot-advance')
    .map(
      (event) => getMandatoryBeatTextById(storyArc, event.beatId) ?? beatIdToText.get(event.beatId)
    )
    .filter((beat): beat is string => !!beat)
}

export function deriveVerifiedMandatoryBeatIdsFromPlotAdvanceEvents(
  events: StoryEvent[],
  storyArc: ReducedGraphState['storyArc']
): string[] {
  const verified = new Set<string>()
  for (const event of events) {
    if (event.type !== 'plot-advance') continue
    if (findMandatoryBeatById(storyArc, event.beatId)) {
      verified.add(event.beatId)
    }
  }
  return Array.from(verified)
}

export function updateOutlineVerifiedBeats(
  outline: ReducedGraphState['outline'],
  chapterIndex: number,
  verifiedBeats: string[],
  verifiedMandatoryBeatIds: string[] = []
): ReducedGraphState['outline'] {
  const currentOutline = outline[chapterIndex]
  if (!currentOutline || (verifiedBeats.length === 0 && verifiedMandatoryBeatIds.length === 0)) {
    return outline
  }
  const merged = Array.from(new Set([...(currentOutline.verifiedBeats ?? []), ...verifiedBeats]))
  const mergedIds = Array.from(
    new Set([...(currentOutline.verifiedMandatoryBeatIds ?? []), ...verifiedMandatoryBeatIds])
  )
  const next = [...outline]
  next[chapterIndex] = {
    ...currentOutline,
    ...(merged.length > 0 ? { verifiedBeats: merged } : {}),
    ...(mergedIds.length > 0 ? { verifiedMandatoryBeatIds: mergedIds } : {}),
  }
  return next
}

export function filterStoryEventsForStoryArc(
  events: StoryEvent[],
  storyArc: ReducedGraphState['storyArc']
): StoryEvent[] {
  if (!storyArc) return events
  const validBeatIds = new Set([
    ...storyArc.keyBeats.map((beat) => beat.id),
    ...getMandatoryBeatEntries(storyArc).map((entry) => entry.id),
  ])
  return events.filter((event) => event.type !== 'plot-advance' || validBeatIds.has(event.beatId))
}

export function filterStoryEventsForEvidence(
  events: StoryEvent[],
  chapterContent: string
): StoryEvent[] {
  const paragraphCount = countEvidenceParagraphs(chapterContent)
  return events.filter((event) => {
    const evidence = event.evidence
    return (
      !!evidence &&
      Number.isInteger(evidence.paragraphIndex) &&
      evidence.paragraphIndex >= 1 &&
      evidence.paragraphIndex <= paragraphCount
    )
  })
}

const FORBIDDEN_SUMMARY_FALLBACK_EVENT_TYPES: ReadonlySet<StoryEvent['type']> = new Set([
  'foreshadow-introduce',
  'foreshadow-fulfill',
  'foreshadow-deadline-extend',
  'foreshadow-waive',
  'foreshadow-merge',
  'plot-advance',
])

export function filterSummaryFallbackEvents(
  events: StoryEvent[],
  chapterIndex: number,
  existingEventIds: ReadonlySet<string>
): StoryEvent[] {
  const seenEventIds = new Set(existingEventIds)
  return events.filter((event) => {
    if (event.source !== 'chapter' || event.chapterIndex !== chapterIndex) return false
    if (seenEventIds.has(event.id)) return false
    if (FORBIDDEN_SUMMARY_FALLBACK_EVENT_TYPES.has(event.type)) return false
    seenEventIds.add(event.id)
    return true
  })
}

export function filterSummaryFallbackEventsForAuthority(
  state: ReducedGraphState,
  events: StoryEvent[],
  chapterIndex: number
): StoryEvent[] {
  const issues = validatePlannedStoryEventAuthority(state, events)
  if (issues.length === 0) return events

  const fieldsByEventIndex = new Map<number, Set<string>>()
  for (const issue of issues) {
    const fields = fieldsByEventIndex.get(issue.index) ?? new Set<string>()
    fields.add(issue.field)
    fieldsByEventIndex.set(issue.index, fields)
  }

  for (const [eventIndex, fields] of fieldsByEventIndex) {
    const event = events[eventIndex]
    if (!event) continue
    logger.warn(
      `[MuseFlow] 第 ${chapterIndex + 1} 章摘要补提事件未通过结构化 ID 权威校验，已丢弃（eventId=${event.id}, eventIndex=${eventIndex}, type=${event.type}, fields=${[...fields].sort().join(',')}）`
    )
  }

  return events.filter((_, eventIndex) => !fieldsByEventIndex.has(eventIndex))
}

export function buildActBoundaryPendingIssue(
  storyId: string,
  act: ActArc,
  pendingBeats: string[],
  uncorroboratedBeatIds: readonly string[] = []
): Issue {
  const extensionChapters = Math.min(2, Math.max(1, pendingBeats.length))
  const rewriteCommand = `museflow rewrite ${storyId} -c ${act.endChapter}`
  const proposal: ActBoundaryProposal = {
    actIndex: act.index,
    proposedEndChapter: act.endChapter + extensionChapters,
    reason: `第 ${act.index} 幕结束时仍有 mandatory beats 未消费。`,
  }
  const corroborationNote =
    uncorroboratedBeatIds.length > 0
      ? `其中 ${uncorroboratedBeatIds.length} 个（${uncorroboratedBeatIds.join('、')}）虽有正文推进事件但未通过佐证审计（缺少绑定的状态类事件或受佐证的终态声明），幕关闭质量复审不予通过。`
      : ''

  return {
    id: `act-${act.index}-pending-beats-at-boundary`,
    ruleId: 'outline-coverage.pending-beats-at-boundary',
    type: 'outline_coverage',
    severity: 'error',
    subject: `act-${act.index}`,
    description: `第 ${act.index} 幕已到结束章节第 ${act.endChapter} 章，但仍有 ${pendingBeats.length} 个 mandatory beats 未消费：${pendingBeats.join('、')}。${corroborationNote}不能在本幕未完成时进入下一幕；请运行 ${rewriteCommand} 重写本幕末章，或运行 ${formatActBoundaryAdjustmentCommand(storyId, proposal)} 延长本幕后再继续。`,
    suggestion: `运行 ${rewriteCommand} 重写当前章节，或运行 ${formatActBoundaryAdjustmentCommand(storyId, proposal)} 延长本幕。`,
    source: 'outline_compliance',
    retryStrategy: 'manual',
  }
}

export function buildRequiredBeatCompletionIssues(
  beatIds: readonly string[],
  chapterIndex: number,
  existingIssues: readonly Issue[]
): Issue[] {
  const existingBeatIds = new Set(
    existingIssues
      .filter((issue) => issue.ruleId === 'story-completion.required-beat-unproven')
      .flatMap((issue) => (issue.subject ? [issue.subject] : []))
  )
  return beatIds
    .filter((beatId) => !existingBeatIds.has(beatId))
    .map((beatId) => ({
      id: `story-completion-unproven-${beatId}-${chapterIndex}`,
      ruleId: 'story-completion.required-beat-unproven',
      type: 'outline_coverage' as const,
      severity: 'error' as const,
      description: `required beat ${beatId} 已到结构边界，但尚无通过验证的 StoryMemory 事件证据，不能完成当前叙事阶段。`,
      subject: beatId,
      location: `第 ${chapterIndex + 1} 章`,
      source: 'outline_compliance' as const,
      retryStrategy: 'draft' as const,
    }))
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isChapterHandoff(value: unknown): value is ChapterHandoff {
  if (!value || typeof value !== 'object') return false
  const handoff = value as Record<string, unknown>
  return (
    typeof handoff.chapterNumber === 'number' &&
    typeof handoff.endScene === 'string' &&
    (typeof handoff.endTime === 'string' ||
      (typeof handoff.endTime === 'object' && handoff.endTime !== null)) &&
    isStringArray(handoff.charactersPresent) &&
    typeof handoff.lastAction === 'string' &&
    isStringArray(handoff.openQuestions) &&
    (!('requiredNextOpening' in handoff) || typeof handoff.requiredNextOpening === 'string')
  )
}

export function isSummaryData(data: unknown): data is {
  storyEvents?: StoryEvent[]
  chapterSummary?: string
  chapterHandoff?: ChapterHandoff
} {
  return (
    typeof data === 'object' && data !== null && ('storyEvents' in data || 'chapterSummary' in data)
  )
}
