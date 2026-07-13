import { logger } from '../../../utils/logger.js'
import type { Issue } from '../../../types/agent.js'
import type { CanonicalFact, FactAttribute, StoryState } from '../../../types/story-state.js'
import { factAttributeFromLabel } from '../../../types/story-state.js'
import type { StoryMemory } from '../../../types/story-memory.js'
import {
  chatStructuredFallback,
  type JsonSchema,
  type Message,
  type ModelProvider,
} from '../../../model/provider.js'
import { generateId } from '../../../utils/id.js'
import { createEmptyStoryState } from '../../../storage/meta/stores/story-state.js'
import { resolveEntityAttribute } from '../../../utils/canonical-facts.js'
import { mergeStoryState } from '../../utils/reconciler/state-merge.js'
import { formatStoryState } from '../../utils/reconciler/format.js'

/**
 * LLM 提出的单条状态修正提案。所有字段均为结构化数据：
 * subject/attribute/newValue 使用实体 id 与属性枚举，
 * evidenceChapter 为 1-based 章号，oldValue 必须与当前记录精确相等。
 */
export interface StateRepairProposal {
  subject: string
  attribute: string
  oldValue: string
  newValue: string
  evidenceChapter: number
  rationale: string
}

export interface StateRepairInput {
  /** 触发修复的状态污染类 error issue。 */
  issues: Issue[]
  storyState: StoryState
  storyMemory: StoryMemory | null
  /** 已定稿章节摘要（按章序），作为提案的叙事上下文。 */
  chapterSummaries: string[]
  /** 当前章 index（0-based）。 */
  currentChapterIndex: number
  /** 上轮被结构化校验拒绝的提案及原因，供本轮提案参考避免重复。 */
  previousRejections?: string[]
}

export interface StateRepairOutcome {
  /** 通过结构化校验并已写入的权威事实。 */
  acceptedFacts: CanonicalFact[]
  /** 合并了 acceptedFacts 的 storyState；无有效提案时返回原引用。 */
  storyState: StoryState
  rejectedCount: number
  /** 本轮被拒提案的结构化反馈（含原因），供下次尝试回传给 LLM。 */
  rejectionFeedback: string[]
}

export interface StateRepairValidationContext {
  knownEntityIds: Set<string>
  locationEntityIds: Set<string>
  characterEntityIds: Set<string>
  itemEntityIds: Set<string>
  storyState: StoryState
  /** 当前章 index（0-based）；evidenceChapter 必须 < 当前章号。 */
  currentChapterIndex: number
}

const STATE_REPAIR_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          attribute: { type: 'string' },
          oldValue: { type: 'string' },
          newValue: { type: 'string' },
          evidenceChapter: { type: 'number' },
          rationale: { type: 'string' },
        },
        required: ['subject', 'attribute', 'oldValue', 'newValue', 'evidenceChapter', 'rationale'],
      },
    },
  },
  required: ['proposals'],
}

function collectKnownEntityIds(memory: StoryMemory): Set<string> {
  return new Set([
    ...Object.keys(memory.entities.characters),
    ...Object.keys(memory.entities.items),
    ...Object.keys(memory.entities.locations),
    ...Object.keys(memory.entities.factions),
  ])
}

function collectCharacterEntityIds(memory: StoryMemory): Set<string> {
  return new Set(Object.keys(memory.entities.characters))
}

function collectItemEntityIds(memory: StoryMemory): Set<string> {
  return new Set(Object.keys(memory.entities.items))
}

/**
 * 对单条提案做严格结构化校验（精确相等 / 枚举 / 已知 id 集合，不做任何模糊文本匹配）。
 */
export function validateStateRepairProposal(
  proposal: StateRepairProposal,
  ctx: StateRepairValidationContext
): { accepted: boolean; attribute?: FactAttribute; reason?: string } {
  const subject = typeof proposal.subject === 'string' ? proposal.subject.trim() : ''
  if (subject.length === 0 || !ctx.knownEntityIds.has(subject)) {
    return { accepted: false, reason: `subject ${proposal.subject} 不是已知实体 id` }
  }

  const rawAttribute = typeof proposal.attribute === 'string' ? proposal.attribute : ''
  const attribute = factAttributeFromLabel(rawAttribute.trim())
  if (attribute === null) {
    return { accepted: false, reason: `attribute ${rawAttribute} 不是可识别的属性枚举` }
  }

  const newValue = typeof proposal.newValue === 'string' ? proposal.newValue.trim() : ''
  if (newValue.length === 0) {
    return { accepted: false, reason: 'newValue 为空' }
  }
  if (attribute === 'location') {
    const subjectIsItem = ctx.itemEntityIds.has(subject)
    const subjectIsCharacter = ctx.characterEntityIds.has(subject)
    const validLocations = subjectIsItem
      ? new Set([...ctx.locationEntityIds, ...ctx.characterEntityIds, ...ctx.itemEntityIds])
      : ctx.locationEntityIds
    if (!validLocations.has(newValue)) {
      return {
        accepted: false,
        attribute,
        reason: `newValue ${newValue} 不是该实体允许的 location id`,
      }
    }
    // 角色 location 必须是地点；物品 location 可以是地点、持有者或其他物品
    if (subjectIsCharacter && !ctx.locationEntityIds.has(newValue)) {
      return {
        accepted: false,
        attribute,
        reason: `newValue ${newValue} 不是已知地点实体 id（角色位置不允许设为其他实体）`,
      }
    }
  }

  const { evidenceChapter } = proposal
  if (
    typeof evidenceChapter !== 'number' ||
    !Number.isInteger(evidenceChapter) ||
    evidenceChapter < 1 ||
    evidenceChapter > ctx.currentChapterIndex
  ) {
    return {
      accepted: false,
      attribute,
      reason: `evidenceChapter ${String(evidenceChapter)} 不是早于当前章的合法章号`,
    }
  }

  const recorded = resolveEntityAttribute(ctx.storyState, subject, attribute)
  if (recorded === undefined) {
    return { accepted: false, attribute, reason: `${subject}/${attribute} 当前无记录值可核对` }
  }
  if (proposal.oldValue !== recorded) {
    return {
      accepted: false,
      attribute,
      reason: `oldValue 与当前记录值不精确相等（记录值: ${recorded}）`,
    }
  }
  if (newValue === recorded) {
    return { accepted: false, attribute, reason: 'newValue 与当前记录值相同，无需修复' }
  }

  return { accepted: true, attribute }
}

function buildRepairMessages(input: StateRepairInput, memory: StoryMemory): Message[] {
  const chapterNumber = input.currentChapterIndex + 1
  const issuesText = input.issues
    .map((issue) => {
      const dimension = issue.dimension ? `（维度: ${issue.dimension}）` : ''
      const subject = issue.subject ? `（subject: ${issue.subject}）` : ''
      const location = issue.location ? `（位置: ${issue.location}）` : ''
      const actual = issue.actualValue ? `（实际值: ${issue.actualValue}）` : ''
      const expected = issue.expectedValue ? `（期望值: ${issue.expectedValue}）` : ''
      const attribute = issue.conflictAttribute ? `（属性: ${issue.conflictAttribute}）` : ''
      const suggestion = issue.suggestion ? `\n  建议: ${issue.suggestion}` : ''
      return `- [${issue.type}]${dimension}${subject}${attribute}${actual}${expected}${location} ${issue.description}${suggestion}`
    })
    .join('\n')

  const knownEntityIds = collectKnownEntityIds(memory)
  const locationIds = Object.keys(memory.entities.locations)
  const recentSummaries = input.chapterSummaries.slice(-5)

  // 提取问题中涉及的实体，把相关权威事实/被覆盖事实展示给模型，帮助定位历史污染
  const involvedSubjects = new Set<string>()
  for (const issue of input.issues) {
    if (issue.subject) {
      involvedSubjects.add(issue.subject.split('/')[0]!.trim())
    }
    if (issue.actualValue && !issue.actualValue.includes(' ')) {
      involvedSubjects.add(issue.actualValue)
    }
    if (issue.expectedValue && !issue.expectedValue.includes(' ')) {
      involvedSubjects.add(issue.expectedValue)
    }
  }
  const relevantFacts = (input.storyState.canonicalFacts ?? []).filter((f) =>
    involvedSubjects.has(f.subject)
  )
  const relevantSuperseded = (input.storyState.supersededFacts ?? []).filter((f) =>
    involvedSubjects.has(f.subject)
  )

  const previousRejections = input.previousRejections ?? []
  const rejectionSection =
    previousRejections.length > 0
      ? `【上轮被拒提案及原因（禁止原样重复，需根据原因修正或放弃）】\n${previousRejections.map((r) => `- ${r}`).join('\n')}\n\n`
      : ''

  return [
    {
      role: 'system',
      content: `你是故事状态记录修复助手。你的任务是修正"与已定稿章节正文矛盾的状态记录"。

背景：状态记录（角色/物品的位置、状态、持有者等结构化字段）可能因历史章节的事件提取遗漏而过期，与已定稿章节的正文矛盾。此时正文是正确的，需要修正的是状态记录。

提案规则（必须全部遵守）：
1. 每条提案修正一条状态记录：subject（实体 id）、attribute（属性枚举）、oldValue（当前记录值）、newValue（修正后的值）、evidenceChapter（证据章号，1-based）、rationale（依据说明）。
2. subject 必须来自【已知实体 id】列表，不得创造新实体。
3. attribute 必须使用以下枚举值之一，禁止输出中文自然语言标签：location, status, origin, maker, giver, holder, identity, known_info, promise, attitude, dialogue, decision, plan, key_event, event, occurrence, result, twist。
4. attribute 为 location 时：
   - 若 subject 是角色，newValue 必须来自【已知地点 id】列表；
   - 若 subject 是物品，newValue 可以是地点 id、持有者角色 id，或存放它的容器物品 id。
5. attribute 为 holder 时，subject 必须是物品，newValue 必须是持有者角色 id。
6. oldValue 必须与【当前状态记录】中该 subject + attribute 的记录值完全一致。
7. 证据只能来自已定稿章节：evidenceChapter 必须小于当前章号（${chapterNumber}）。
8. 只修正确有正文证据支持的记录；无法确定正确值时不要提案。不要修改正文，不要推测未发生的情节。

请输出 JSON，格式为 {"proposals": [{"subject": "...", "attribute": "...", "oldValue": "...", "newValue": "...", "evidenceChapter": 1, "rationale": "..."}, ...]}。没有可修正的记录时返回 {"proposals": []}。`,
    },
    {
      role: 'user',
      content: `【当前章号】第 ${chapterNumber} 章

【待修复的状态问题】
${issuesText}

【当前状态记录】
${formatStoryState(input.storyState, memory.entities)}

${relevantFacts.length > 0 ? `【相关权威事实（按问题涉及的实体筛选）】\n${relevantFacts.map((f) => `- ${f.subject} / ${f.attribute}: ${f.value}（来源: ${f.source}, 确立于第 ${f.establishedIn + 1} 章${f.retiredIn !== undefined ? `, 废止于第 ${f.retiredIn + 1} 章` : ''}）`).join('\n')}\n\n` : ''}${relevantSuperseded.length > 0 ? `【相关被覆盖事实】\n${relevantSuperseded.map((f) => `- ${f.subject}: ${f.oldFact}（原因: ${f.reason}）`).join('\n')}\n\n` : ''}【已知实体 id】
${[...knownEntityIds].join('、')}

【已知地点 id】
${locationIds.join('、') || '（无）'}

【已定稿章节摘要（最近）】
${recentSummaries.length > 0 ? recentSummaries.map((s, i) => `- ${i + 1}. ${s}`).join('\n') : '（无）'}

${rejectionSection}请输出 JSON。`,
    },
  ]
}

async function requestRepairProposals(
  input: StateRepairInput,
  memory: StoryMemory,
  provider: ModelProvider
): Promise<StateRepairProposal[]> {
  const messages = buildRepairMessages(input, memory)
  let raw: unknown
  if (provider.chatStructured) {
    try {
      raw = await provider.chatStructured<{ proposals: StateRepairProposal[] }>(
        messages,
        STATE_REPAIR_SCHEMA,
        0.2
      )
    } catch (structuredErr) {
      logger.debug(
        '[MuseFlow] 状态修复结构化输出失败，回退到普通 chat 解析:',
        structuredErr instanceof Error ? structuredErr.message : String(structuredErr)
      )
      raw = await chatStructuredFallback<{ proposals: StateRepairProposal[] }>(
        provider,
        messages,
        STATE_REPAIR_SCHEMA,
        0.2
      )
    }
  } else {
    raw = await chatStructuredFallback<{ proposals: StateRepairProposal[] }>(
      provider,
      messages,
      STATE_REPAIR_SCHEMA,
      0.2
    )
  }

  const parsed = raw as { proposals?: StateRepairProposal[] }
  return Array.isArray(parsed.proposals) ? parsed.proposals : []
}

/**
 * 基于状态污染类 issue 让 LLM 提出结构化状态修正提案，
 * 经严格结构化校验后写入权威事实（source: 'state_repair'），
 * 并立即合并进 storyState 使后续重渲染/重校验生效。
 *
 * 无任何提案通过校验时不修改状态（返回原 storyState 引用）；被拒提案原因
 * 通过 rejectionFeedback 回传，供本章下一次修复尝试参考（每章最多 2 次），
 * 尝试耗尽后 routing 退回人工 request_rewrite。
 */
export async function repairCorruptedState(
  input: StateRepairInput,
  provider: ModelProvider
): Promise<StateRepairOutcome> {
  if (input.issues.length === 0 || !input.storyMemory) {
    return {
      acceptedFacts: [],
      storyState: input.storyState,
      rejectedCount: 0,
      rejectionFeedback: [],
    }
  }

  let proposals: StateRepairProposal[]
  try {
    proposals = await requestRepairProposals(input, input.storyMemory, provider)
  } catch (err) {
    logger.warn(
      '[MuseFlow] 状态修复提案生成失败，跳过自动修复:',
      err instanceof Error ? err.message : String(err)
    )
    return {
      acceptedFacts: [],
      storyState: input.storyState,
      rejectedCount: 0,
      rejectionFeedback: [],
    }
  }

  const validationCtx: StateRepairValidationContext = {
    knownEntityIds: collectKnownEntityIds(input.storyMemory),
    locationEntityIds: new Set(Object.keys(input.storyMemory.entities.locations)),
    characterEntityIds: collectCharacterEntityIds(input.storyMemory),
    itemEntityIds: collectItemEntityIds(input.storyMemory),
    storyState: input.storyState,
    currentChapterIndex: input.currentChapterIndex,
  }

  const acceptedFacts: CanonicalFact[] = []
  const rejectionFeedback: string[] = []
  let rejectedCount = 0
  for (const proposal of proposals) {
    const verdict = validateStateRepairProposal(proposal, validationCtx)
    if (!verdict.accepted) {
      rejectedCount++
      rejectionFeedback.push(
        `${proposal.subject}/${proposal.attribute}: ${proposal.oldValue} → ${proposal.newValue}（${verdict.reason}）`
      )
      logger.info(
        `[MuseFlow] 状态修复提案被拒：${proposal.subject}/${proposal.attribute}（${verdict.reason}）`
      )
      continue
    }
    acceptedFacts.push({
      id: generateId('fact'),
      subject: proposal.subject.trim(),
      attribute: verdict.attribute!,
      value: proposal.newValue.trim(),
      establishedIn: input.currentChapterIndex,
      confidence: 'high',
      source: 'state_repair',
      evidence: {
        chapterIndex: proposal.evidenceChapter - 1,
        quote: proposal.rationale.slice(0, 200),
      },
    })
  }

  if (acceptedFacts.length === 0) {
    logger.warn('[MuseFlow] 状态修复未产生任何通过校验的提案，保持状态不变')
    return { acceptedFacts: [], storyState: input.storyState, rejectedCount, rejectionFeedback }
  }

  logger.info(`[MuseFlow] 状态修复写入 ${acceptedFacts.length} 条权威事实（state_repair）`)
  for (const fact of acceptedFacts) {
    logger.info(`  - [${fact.subject}] ${fact.attribute}: ${fact.value}`)
  }

  const storyState = mergeStoryState(input.storyState, {
    ...createEmptyStoryState(),
    canonicalFacts: acceptedFacts,
  })

  return { acceptedFacts, storyState, rejectedCount, rejectionFeedback }
}
