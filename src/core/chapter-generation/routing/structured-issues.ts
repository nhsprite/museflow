import type { Issue, IssueType } from '../../../types/agent.js'
import type { StructuredValidationResult } from '../../../story-memory/validator.js'
import { generateId } from '../../../utils/id.js'
import { inferRetryStrategy } from '../../../utils/retry-strategy.js'

export const STRUCTURED_ISSUE_TYPES = new Set<IssueType>([
  'state_conflict',
  'beat_unproven',
  'beat_uncorroborated',
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
  chapterIndex: number,
  options: { requireMandatoryBeatClaim?: boolean } = {}
): Issue[] {
  if (!result) return []

  const issues: Issue[] = []

  // C.2.1 零事件章节信号：过滤（含未授权丢弃）后 draft 事件为空且规划未要求任何事件，
  // 说明本章对故事状态与情节均无结构化推进。warning 级，由跨章零增量闸负责升级。
  const droppedEventIds = new Set(
    (result.droppedUnauthorizedPlotAdvanceEvents ?? []).map((event) => event.id)
  )
  const effectiveDraftEvents = result.actualEvents.filter((event) => !droppedEventIds.has(event.id))
  if (effectiveDraftEvents.length === 0 && result.expectedEvents.length === 0) {
    issues.push({
      id: generateId(),
      ruleId: 'structured.zero-event-chapter',
      type: 'event_missing',
      severity: 'warning',
      description: '本章未产生任何结构化事件，章节规划也未要求事件：本章对故事状态与情节均无推进。',
      source: 'outline_compliance',
      location: `第 ${chapterIndex + 1} 章`,
    })
  }

  // C.2.1 消费此前被算出即丢弃的 unclaimedMandatoryBeats 信号：仅在强制认领义务下
  // （幕边界高压，requireMandatoryBeatClaim 由路由层按压力判定注入）本章仍零认领时
  // 报 error——这是高压不变量在校验层的兜底（大纲层已先行拦截，此处原则上不应触发）。
  if (options.requireMandatoryBeatClaim && (result.claimedMandatoryBeatIds ?? []).length === 0) {
    for (const beatId of result.unclaimedMandatoryBeats) {
      issues.push(
        structuredError(chapterIndex, {
          ruleId: 'structured.mandatory-beat-unclaimed',
          type: 'beat_unproven',
          subject: beatId,
          description: `幕边界高压下本章必须消费 mandatory beat，但当前幕待消费的 ${beatId} 未出现在本章认领中（本章零认领）。`,
          suggestion:
            '在本章大纲与规划中认领当前幕至少 1 个待消费 mandatory beat，并在正文中写出该节拍所述事件的可观察完成。',
          source: 'outline_compliance',
        })
      )
    }
  }

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
  // B.1 终态不变量：已终态（alive=false）实体再被事件引用 / 再次被宣告死亡，均为硬错误。
  for (const violation of result.terminalStateViolations ?? []) {
    issues.push(
      structuredError(chapterIndex, {
        ruleId: 'structured.entity-terminal-state-violation',
        type: 'state_conflict',
        subject: violation.entityId,
        description: `实体 ${violation.entityId} 已处于终态（alive=false），本章事件 ${violation.event.id}（${violation.event.type}）仍引用该实体；终态实体不得再产生位置/状态/持有人等事件`,
        suggestion:
          '若该实体确实复活，必须改用显式 character-revival 事件（带 @pN 正文证据）先清除终态标记，再输出后续事件；否则删除对该终态实体的事件引用。',
        source: 'state_reconciliation',
      })
    )
  }
  for (const violation of result.terminalDuplicateEvents ?? []) {
    issues.push(
      structuredError(chapterIndex, {
        ruleId: 'structured.entity-terminal-duplicate',
        type: 'state_conflict',
        subject: violation.entityId,
        description: `实体 ${violation.entityId} 此前已被宣告终态（alive=false），本章事件 ${violation.event.id} 再次宣告其死亡（重复终态事件）`,
        suggestion:
          '同一实体的终态只能确立一次：删除重复的死亡事件；若前次死亡已被推翻，必须先以显式 character-revival 事件反转终态。',
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
  // D.2.1 mandatory beat 消费佐证：proven 但未留下结构化痕迹的 mandatory beat 不予消费。
  // 本章认领的给 error（一次携带 beatCorroboration 反馈的起草重试，重试耗尽由路由层
  // 转换为 beat_unproven 走现有撤销/大纲重生成路径）；未认领但经正文验证成立的只给
  // warning——作为真实进展接受，但幕关闭复审时仍视为未消费。
  const claimedMandatoryBeatIdSet = new Set(result.claimedMandatoryBeatIds ?? [])
  for (const evaluation of result.beatCorroborations ?? []) {
    if (evaluation.corroborated) continue
    if (claimedMandatoryBeatIdSet.has(evaluation.beatId)) {
      issues.push(
        structuredError(chapterIndex, {
          ruleId: 'structured.beat-uncorroborated',
          type: 'beat_uncorroborated',
          subject: evaluation.beatId,
          description: `mandatory beat ${evaluation.beatId} 的推进事件已通过正文验证，但声称的结局未留下结构化痕迹：本章没有与该推进事件因果绑定（共享 @pN 证据锚点或共享主体实体）的状态类事件，也没有受事件流佐证且与该 beat 绑定的章末终态声明。`,
          suggestion:
            `声称的结局必须留下结构化痕迹，二选一：1) 在 STORY_EVENTS 中补一条状态类事件（位置/状态/物品/伏笔回收/任务），其 @pN 证据锚点与该 beat 的推进事件（${evaluation.provingEventIds.join('、')}）指向同一段落，或主体实体相同；` +
            `2) 在 STORY_FINAL_STATE 中输出该结局的终态声明，并以同章事件流佐证、与推进事件绑定。重试后仍未佐证的认领将按未证明处理。`,
          source: 'outline_compliance',
        })
      )
    } else {
      issues.push({
        id: generateId(),
        ruleId: 'structured.beat-uncorroborated',
        type: 'beat_uncorroborated',
        subject: evaluation.beatId,
        severity: 'warning',
        description: `未认领的 mandatory beat ${evaluation.beatId} 经正文验证成立，但缺少结构化佐证（绑定的状态类事件或受佐证的终态声明）；该 beat 作为真实进展接受，但幕关闭复审时仍视为未消费。`,
        source: 'outline_compliance',
        location: `第 ${chapterIndex + 1} 章`,
      })
    }
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
  // 未授权 plot-advance 的丢弃项：正文级语义验证未通过，降级为 warning，不阻塞章节。
  for (const event of result.droppedUnauthorizedPlotAdvanceEvents ?? []) {
    issues.push({
      id: generateId(),
      ruleId: 'structured.plot-advance-unauthorized-dropped',
      type: 'event_unexpected',
      subject: event.beatId,
      severity: 'warning',
      description: `正文声明了未由章节规划授权的节拍推进事件 ${event.id}（beatId=${event.beatId}），未通过语义验证，已从事件流丢弃；该节拍保持未消费状态`,
      source: 'outline_compliance',
      location: `第 ${chapterIndex + 1} 章`,
    })
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
      ...(mismatch.actualValue !== null
        ? {
            suggestion:
              `二选一修复：1) 若章末该实体确实处于声明值「${mismatch.declaredValue}」，在 STORY_EVENTS 末尾补一条该实体的${attributeLabel}事件（值=声明值，@pN 指向归位/状态回写段落），补后最后一条${attributeLabel}事件必须与声明值一致；` +
              `2) 若章末该实体实际处于「${mismatch.actualValue}」，将 STORY_FINAL_STATE 的声明值改为 ${mismatch.actualValue}。`,
          }
        : {}),
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
