import type { Issue, IssueType } from '../../../types/agent.js'
import type { StructuredValidationResult } from '../../../story-memory/validator.js'
import { generateId } from '../../../utils/id.js'
import { inferRetryStrategy } from '../../../utils/retry-strategy.js'

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
  const base: Issue = {
    ...issue,
    id: generateId(),
    severity: 'error',
    location: `第 ${chapterIndex + 1} 章`,
  }
  return { ...base, retryStrategy: inferRetryStrategy(base) }
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
        ruleId: 'structured.state-conflict',
        type: 'state_conflict',
        subject: conflict.entityId,
        conflictAttribute: conflict.attribute,
        description: conflict.description,
        source: 'state_reconciliation',
      })
    )
  }
  const rejectedBeatIds = new Set<string>()
  for (const rejection of result.plotAdvanceRejections ?? []) {
    rejectedBeatIds.add(rejection.beatId)
    issues.push(
      structuredError(chapterIndex, {
        ruleId: 'structured.beat-unproven',
        type: 'beat_unproven',
        subject: rejection.beatId,
        description: `节拍 ${rejection.beatId} 的推进事件 ${rejection.eventId} 未通过语义验证（${rejection.verdict}）：${rejection.reason}`,
        suggestion:
          '在正文中把该节拍落实为可观察的事件场景（行动、揭示、决定或后果，而不是保持原状、氛围铺垫或口头声称"已完成"），并将 plot-advance 事件的 @pN 证据指向写出该场景的段落。',
        source: 'outline_compliance',
      })
    )
  }
  for (const beatId of result.claimedButUnprovenBeats) {
    if (rejectedBeatIds.has(beatId)) continue
    issues.push(
      structuredError(chapterIndex, {
        ruleId: 'structured.beat-unproven',
        type: 'beat_unproven',
        subject: beatId,
        description: `认领的节拍 ${beatId} 未在正文中找到对应事件`,
        suggestion:
          '正文未实质推进该节拍：需在正文中写出该节拍的可观察事件场景，并在 STORY_EVENTS 中声明对应 plot-advance 事件，@pN 证据指向该场景所在段落。',
        source: 'outline_compliance',
      })
    )
  }
  for (const foreshadowId of result.falseFulfillments) {
    const semanticRejection = result.foreshadowFulfillmentRejections?.find(
      (rejection) => rejection.foreshadowId === foreshadowId
    )
    issues.push(
      structuredError(chapterIndex, {
        ruleId: 'structured.foreshadow-false-fulfillment',
        type: 'foreshadow_false_fulfillment',
        subject: foreshadowId,
        description: semanticRejection
          ? `声称兑现的伏笔 ${foreshadowId} 未通过语义验证（${semanticRejection.verdict}）：${semanticRejection.reason}`
          : `声称兑现的伏笔 ${foreshadowId} 未在正文中发生`,
        source: 'foreshadowing',
      })
    )
  }
  for (const event of result.eventsWithInvalidForeshadowDeadline ?? []) {
    issues.push(
      structuredError(chapterIndex, {
        ruleId: 'structured.foreshadow-invalid-deadline',
        type: 'foreshadow_invalid_deadline',
        subject: event.foreshadowId,
        description: `伏笔 ${event.foreshadowId} 的预期回收章节 ${String(event.expectedFulfillChapter)} 必须晚于引入章节 ${event.chapterIndex + 1}`,
        source: 'foreshadowing',
      })
    )
  }
  for (const event of result.missingEvents) {
    issues.push(
      structuredError(chapterIndex, {
        ruleId: 'structured.event-missing',
        type: 'event_missing',
        subject: event.id,
        description: `章节规划要求的结构化事件 ${event.id}（${event.type}）未在正文 STORY_EVENTS 中验证到`,
        source: 'outline_compliance',
      })
    )
  }
  for (const event of result.unexpectedEvents) {
    issues.push(
      structuredError(chapterIndex, {
        ruleId: 'structured.event-unexpected',
        type: 'event_unexpected',
        subject: event.id,
        description: `正文 STORY_EVENTS 声明了未由章节规划授权的结构化事件 ${event.id}（${event.type}）`,
        source: 'outline_compliance',
      })
    )
  }
  for (const event of result.eventsMissingEvidence) {
    issues.push(
      structuredError(chapterIndex, {
        ruleId: 'structured.event-evidence-missing',
        type: 'event_evidence_missing',
        subject: event.id,
        description: `结构化事件 ${event.id}（${event.type}）缺少正文段落证据，不能写入 StoryMemory`,
        source: 'outline_compliance',
      })
    )
  }
  for (const event of result.eventsWithInvalidEvidence) {
    issues.push(
      structuredError(chapterIndex, {
        ruleId: 'structured.event-evidence-invalid',
        type: 'event_evidence_invalid',
        subject: event.id,
        description: `结构化事件 ${event.id}（${event.type}）引用了不存在的正文段落证据`,
        source: 'outline_compliance',
      })
    )
  }
  for (const mismatch of result.finalStateMismatches ?? []) {
    const attributeLabel = mismatch.attribute === 'location' ? '位置' : '状态'
    const baseIssue: Omit<Issue, 'id' | 'severity' | 'location' | 'retryStrategy'> = {
      ruleId: 'structured.final-state-mismatch',
      type: 'event_missing',
      subject: mismatch.entityId,
      conflictAttribute: mismatch.attribute,
      expectedValue: mismatch.declaredValue,
      description:
        mismatch.actualValue === null
          ? `章末终态声明 ${mismatch.entityId}（${attributeLabel}=${mismatch.declaredValue}）未被事件流支撑：本章 STORY_EVENTS 中没有该实体的${attributeLabel}事件`
          : `章末终态声明 ${mismatch.entityId}（${attributeLabel}=${mismatch.declaredValue}）与事件流不符：该实体最后一条${attributeLabel}事件的值为 ${mismatch.actualValue}`,
      source: 'outline_compliance',
    }
    if (mismatch.actualValue !== null) {
      baseIssue.actualValue = mismatch.actualValue
    }
    issues.push(structuredError(chapterIndex, baseIssue))
  }

  for (const declaration of result.finalStateUncorroborated ?? []) {
    issues.push({
      id: generateId(),
      ruleId: 'structured.final-state-uncorroborated',
      type: 'event_missing',
      subject: declaration.entityId,
      conflictAttribute: declaration.attribute,
      severity: 'warning',
      description: `章末终态声明 ${declaration.entityId}（${declaration.attribute}=${declaration.declaredValue}）未被本章事件流支撑：该实体本章无对应类型事件，按提示处理`,
      source: 'outline_compliance',
      location: `第 ${chapterIndex + 1} 章`,
    })
  }

  return issues
}

export function replaceStructuredIssues(existing: Issue[], fresh: Issue[]): Issue[] {
  return [...existing.filter((issue) => !STRUCTURED_ISSUE_TYPES.has(issue.type)), ...fresh]
}
