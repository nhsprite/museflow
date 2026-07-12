import type { Issue, IssueType } from '../../../types/agent.js'
import type { StructuredValidationResult } from '../../../story-memory/validator.js'
import { generateId } from '../../../utils/id.js'

export const STRUCTURED_ISSUE_TYPES = new Set<IssueType>([
  'state_conflict',
  'beat_unproven',
  'foreshadow_false_fulfillment',
  'foreshadow_invalid_deadline',
  'event_missing',
  'event_unexpected',
  'event_evidence_missing',
  'event_evidence_invalid',
])

function structuredError(
  chapterIndex: number,
  issue: Omit<Issue, 'id' | 'severity' | 'location' | 'retryStrategy'>
): Issue {
  return {
    ...issue,
    id: generateId(),
    severity: 'error',
    location: `第 ${chapterIndex + 1} 章`,
    retryStrategy: 'draft',
  }
}

export function buildStructuredIssues(
  result: StructuredValidationResult | undefined,
  chapterIndex: number
): Issue[] {
  if (!result) return []

  const issues: Issue[] = []
  for (const conflict of result.stateConflicts) {
    issues.push(
      structuredError(chapterIndex, {
        type: 'state_conflict',
        description: conflict.description,
        source: 'state_reconciliation',
      })
    )
  }
  for (const beatId of result.claimedButUnprovenBeats) {
    issues.push(
      structuredError(chapterIndex, {
        type: 'beat_unproven',
        description: `认领的节拍 ${beatId} 未在正文中找到对应事件`,
        source: 'outline_compliance',
      })
    )
  }
  for (const foreshadowId of result.falseFulfillments) {
    issues.push(
      structuredError(chapterIndex, {
        type: 'foreshadow_false_fulfillment',
        description: `声称兑现的伏笔 ${foreshadowId} 未在正文中发生`,
        source: 'foreshadowing',
      })
    )
  }
  for (const event of result.eventsWithInvalidForeshadowDeadline ?? []) {
    issues.push(
      structuredError(chapterIndex, {
        type: 'foreshadow_invalid_deadline',
        description: `伏笔 ${event.foreshadowId} 的预期回收章节 ${String(event.expectedFulfillChapter)} 必须晚于引入章节 ${event.chapterIndex + 1}`,
        source: 'foreshadowing',
      })
    )
  }
  for (const event of result.missingEvents) {
    issues.push(
      structuredError(chapterIndex, {
        type: 'event_missing',
        description: `章节规划要求的结构化事件 ${event.id}（${event.type}）未在正文 STORY_EVENTS 中验证到`,
        source: 'outline_compliance',
      })
    )
  }
  for (const event of result.unexpectedEvents) {
    issues.push(
      structuredError(chapterIndex, {
        type: 'event_unexpected',
        description: `正文 STORY_EVENTS 声明了未由章节规划授权的结构化事件 ${event.id}（${event.type}）`,
        source: 'outline_compliance',
      })
    )
  }
  for (const event of result.eventsMissingEvidence) {
    issues.push(
      structuredError(chapterIndex, {
        type: 'event_evidence_missing',
        description: `结构化事件 ${event.id}（${event.type}）缺少正文段落证据，不能写入 StoryMemory`,
        source: 'outline_compliance',
      })
    )
  }
  for (const event of result.eventsWithInvalidEvidence) {
    issues.push(
      structuredError(chapterIndex, {
        type: 'event_evidence_invalid',
        description: `结构化事件 ${event.id}（${event.type}）引用了不存在的正文段落证据`,
        source: 'outline_compliance',
      })
    )
  }

  return issues
}

export function replaceStructuredIssues(existing: Issue[], fresh: Issue[]): Issue[] {
  return [...existing.filter((issue) => !STRUCTURED_ISSUE_TYPES.has(issue.type)), ...fresh]
}
