import type {
  FactCoverage,
  NarrativeAuditRecord,
  NarrativeFinding,
  ProseFact,
} from '../../../types/narrative-audit.js'
import type { StoryEvent, CharacterMemory } from '../../../types/story-memory.js'
import type { CanonicalFact } from '../../../types/story-state.js'
import { lifecycleChannelFromStatusEvent } from '../../../story-memory/lifecycle.js'

export function repairSuggestion(target: NarrativeFinding['repairTarget']): string {
  switch (target) {
    case 'current_records':
      return '仅修正本章规划和自报事件/终态记录，使其忠实对应正文，再走完整验证；不得用当前草稿观察覆盖既有权威事实。'
    case 'current_prose':
      return '仅修正当前未定稿正文，保持已定稿前文的事实和因果约束；不得改写前文来迁就当前草稿。若必须改动既有事实，停止自动修复并交由作者裁决。'
    case 'manual_review':
      return '权威依据存在分歧，需要作者核对已定稿正文后裁决；不得自动覆盖记忆或改写前文。'
  }
}

export function isRecordableFact(fact: ProseFact): boolean {
  return (
    fact.scope === 'current' &&
    (fact.entityId !== null || (fact.kind === 'identity' && fact.entityName != null)) &&
    ['lifecycle', 'identity', 'custody'].includes(fact.kind)
  )
}

/** 只对显式受控生命周期字段做精确比对，不从自然语言推断死亡或复生。 */
function matchesLifecycle(record: NarrativeAuditRecord, fact: ProseFact): boolean {
  if (record.kind === 'event') {
    const event = record.value as StoryEvent
    if (event.type === 'character-revival')
      return event.characterId === fact.entityId && fact.value === true
    if (event.type !== 'character-status' || event.characterId !== fact.entityId) return false
    const channel = lifecycleChannelFromStatusEvent(event)
    return channel?.attribute === 'alive' && channel.value === fact.value
  }
  if (record.kind === 'entity') {
    const entity = record.value as CharacterMemory
    return entity.id === fact.entityId && entity.lifecycle?.alive === fact.value
  }
  if (record.kind === 'canonical_fact') {
    const canonical = record.value as CanonicalFact
    return (
      canonical.subject === fact.entityId &&
      canonical.lifecycle?.attribute === 'alive' &&
      canonical.lifecycle.value === fact.value
    )
  }
  return false
}

export function validateFactCoverage(
  facts: ProseFact[],
  coverage: FactCoverage[],
  records: NarrativeAuditRecord[],
  chapterIndex: number
): NarrativeFinding[] {
  const seen = new Set<number>()
  const omissions: NarrativeFinding[] = []
  for (const entry of coverage) {
    const fact = facts[entry.factIndex]
    if (!fact || seen.has(entry.factIndex))
      throw new Error(
        `coverage 的 factIndex=${entry.factIndex} 越界或重复；须逐条覆盖 draftObservations`
      )
    seen.add(entry.factIndex)
    for (const index of entry.recordIndexes)
      if (!records[index]) throw new Error(`coverage 引用了不存在的 recordIndex=${index}`)
    const expectedOrigin =
      entry.verdict === 'recorded'
        ? 'current'
        : entry.verdict === 'unchanged'
          ? 'established'
          : undefined
    if (
      expectedOrigin &&
      !entry.recordIndexes.some((index) => records[index]?.origin === expectedOrigin)
    ) {
      throw new Error(
        `coverage[${entry.factIndex}] ${entry.verdict} 必须引用 ${expectedOrigin} 记录；无记录应判 missing 或 not_recordable/uncertain`
      )
    }
    const controlledLifecycle =
      fact.kind === 'lifecycle' &&
      fact.scope === 'current' &&
      fact.entityId !== null &&
      fact.attribute === 'alive' &&
      typeof fact.value === 'boolean'
    if (controlledLifecycle) {
      const matching = records
        .map((record, index) => ({ record, index }))
        .filter(({ record }) => matchesLifecycle(record, fact))
      if (
        expectedOrigin &&
        !matching.some(
          ({ record, index }) =>
            record.origin === expectedOrigin && entry.recordIndexes.includes(index)
        )
      ) {
        throw new Error(`coverage[${entry.factIndex}] 未引用同一实体同值的类型化生命周期记录`)
      }
      // 明确当前死亡不能通过省略覆盖结论或 not_recordable 静默放行。
      if (fact.value === false) {
        const expected = matching.some(({ record }) => record.origin === 'current')
          ? 'recorded'
          : matching.length > 0
            ? 'unchanged'
            : 'missing'
        if (entry.verdict !== expected)
          throw new Error(
            `coverage[${entry.factIndex}] 当前明确 alive=false，匹配记录要求 verdict=${expected}`
          )
      }
    }
    if (entry.verdict === 'missing') {
      if (!isRecordableFact(fact))
        throw new Error(`coverage[${entry.factIndex}] 不是可登记的当前事实，不能判 missing`)
      omissions.push({
        kind: 'omission',
        factIndexes: [entry.factIndex],
        recordIndexes: entry.recordIndexes,
        evidence: fact.evidenceParagraphs.map((paragraphIndex) => ({
          chapterIndex,
          paragraphIndex,
        })),
        confidence: entry.confidence,
        repairTarget: 'current_records',
        explanation: `正文观察 ${entry.factIndex}（${fact.entityId ?? fact.entityName ?? '新实体'} / ${fact.attribute} = ${JSON.stringify(fact.value)}）尚无对应事件记录。`,
        suggestion: repairSuggestion('current_records'),
      })
    }
  }
  if (seen.size !== facts.length)
    throw new Error(
      `coverage 未覆盖全部 draftObservations：应有 ${facts.length} 条，实际 ${seen.size} 条`
    )
  return omissions
}
